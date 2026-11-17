import { swrWrap } from "@llmgateway/cache";
import {
	cdb,
	db,
	getTableName,
	guardrailConfig,
	guardrailRule,
	guardrailViolation,
	defaultAllowedFileTypes,
	defaultGuardrailClassifierThreshold,
	withDefaultSystemRules,
	and,
	eq,
	desc,
	isNull,
} from "@llmgateway/db";

import {
	systemRules,
	redactPii,
	redactSecrets,
	checkBlockedTerms,
	checkCustomRegex,
	checkMessageFiles,
	checkSensitiveData,
	checkTopicRestriction,
	harmfulContentQuestions,
	harmfulContentRule,
	fileTypesRule,
	injectionQuestion,
	jailbreakQuestion,
	topicLabel,
} from "./rules/index.js";
import { escapeRegex } from "./rules/safe-regex.js";

import type {
	ClassifierOutcome,
	GuardrailInput,
	GuardrailResult,
	RuleViolation,
	RedactionInfo,
	GuardrailConfigData,
	GuardrailScope,
	Message,
	SystemRule,
} from "./types.js";
import type {
	SystemRuleConfig,
	SystemRulesConfig,
	BlockedTermsRuleConfig,
	ClassifierRuleConfig,
	CustomRegexRuleConfig,
	SensitiveDataRuleConfig,
	TopicRestrictionRuleConfig,
	GuardrailAction,
	PiiEntity,
} from "@llmgateway/db";

const guardrailConfigTableName = getTableName(guardrailConfig);
const guardrailRuleTableName = getTableName(guardrailRule);

async function getOrganizationGuardrailConfig(
	organizationId: string,
): Promise<GuardrailConfigData | null> {
	return await swrWrap(
		`guardrailConfig:org:${organizationId}`,
		[guardrailConfigTableName],
		async () => {
			const configs = await cdb
				.select()
				.from(guardrailConfig)
				.where(
					and(
						eq(guardrailConfig.organizationId, organizationId),
						isNull(guardrailConfig.projectId),
					),
				)
				.limit(1);

			return toConfigData(configs[0]);
		},
	);
}

async function getProjectGuardrailConfig(
	projectId: string,
): Promise<GuardrailConfigData | null> {
	return await swrWrap(
		`guardrailConfig:project:${projectId}`,
		[guardrailConfigTableName],
		async () => {
			const configs = await cdb
				.select()
				.from(guardrailConfig)
				.where(eq(guardrailConfig.projectId, projectId))
				.limit(1);

			const config = configs[0];

			// A project row that still inherits is not an override — the caller
			// falls back to the organization config.
			if (!config || config.inheritOrganization) {
				return null;
			}

			return toConfigData(config);
		},
	);
}

function toConfigData(
	config:
		| {
				enabled: boolean;
				systemRules: SystemRulesConfig | null;
				maxFileSizeMb: number;
				allowedFileTypes: string[] | null;
		  }
		| undefined,
): GuardrailConfigData | null {
	if (!config) {
		return null;
	}

	return {
		enabled: config.enabled,
		systemRules: withDefaultSystemRules(config.systemRules),
		maxFileSizeMb: config.maxFileSizeMb,
		allowedFileTypes: config.allowedFileTypes ?? defaultAllowedFileTypes,
	};
}

/**
 * Resolve the guardrail scope that applies to a request. A project that has
 * opted out of the organization config owns both its config and its custom
 * rules; otherwise the organization scope applies.
 */
export async function resolveGuardrailScope(
	organizationId: string,
	projectId?: string,
): Promise<GuardrailScope | null> {
	if (projectId) {
		const projectConfig = await getProjectGuardrailConfig(projectId);
		if (projectConfig) {
			return { config: projectConfig, projectId };
		}
	}

	const orgConfig = await getOrganizationGuardrailConfig(organizationId);
	return orgConfig ? { config: orgConfig, projectId: null } : null;
}

export async function getGuardrailConfig(
	organizationId: string,
	projectId?: string,
): Promise<GuardrailConfigData | null> {
	const scope = await resolveGuardrailScope(organizationId, projectId);
	return scope?.config ?? null;
}

function getGuardrailRules(organizationId: string, scope: GuardrailScope) {
	if (scope.projectId) {
		const { projectId } = scope;
		return swrWrap(
			`guardrailRules:project:${projectId}`,
			[guardrailRuleTableName],
			async () =>
				await cdb
					.select()
					.from(guardrailRule)
					.where(eq(guardrailRule.projectId, projectId))
					.orderBy(desc(guardrailRule.priority)),
		);
	}

	return swrWrap(
		`guardrailRules:org:${organizationId}`,
		[guardrailRuleTableName],
		async () =>
			await cdb
				.select()
				.from(guardrailRule)
				.where(
					and(
						eq(guardrailRule.organizationId, organizationId),
						isNull(guardrailRule.projectId),
					),
				)
				.orderBy(desc(guardrailRule.priority)),
	);
}

/** Roles whose content the operator wrote; instruction-style rules skip them. */
const TRUSTED_ROLES = new Set(["system", "developer"]);

/** The classifier scores the newest text when a conversation is longer. */
const MAX_CLASSIFIER_CHARS = 100_000;

const MAX_MATCHED_CONTENT_CHARS = 100;

interface TextSegment {
	content: string;
	messageIndex: number;
	role: string;
	trusted: boolean;
}

interface PendingQuestion {
	ruleId: string;
	ruleName: string;
	category: string;
	action: GuardrailAction;
	instructions: string;
	threshold: number;
	/** Shown in the violation, e.g. the harmful-content category. */
	label?: string;
}

/**
 * "allow" is logged like "warn"; "redact" on a rule with nothing to redact
 * (an injection, a topic) blocks rather than silently letting it through.
 */
function resolveAction(
	action: GuardrailAction,
	redactable: boolean,
): GuardrailAction {
	if (action === "allow") {
		return "warn";
	}
	if (action === "redact" && !redactable) {
		return "block";
	}
	return action;
}

function resolveThreshold(threshold: number | undefined): number {
	return typeof threshold === "number" && threshold > 0 && threshold < 1
		? threshold
		: defaultGuardrailClassifierThreshold;
}

function truncate(content: string): string {
	return content.substring(0, MAX_MATCHED_CONTENT_CHARS);
}

/** Sample stored on the violation, with the detected values removed. */
function sanitizeSample(
	content: string,
	kind: "pii" | "secrets" | undefined,
	entities?: PiiEntity[],
): string {
	if (kind === "pii") {
		return truncate(redactPii(content, entities).redacted);
	}
	if (kind === "secrets") {
		return truncate(redactSecrets(content).redacted);
	}
	return truncate(content);
}

function systemRuleKey(rule: { id: string }): keyof SystemRulesConfig {
	return rule.id.replace("system:", "") as keyof SystemRulesConfig;
}

function redactionKind(rule: SystemRule): "pii" | "secrets" | undefined {
	if (rule.id === "system:pii_detection") {
		return "pii";
	}
	if (rule.id === "system:secrets") {
		return "secrets";
	}
	return undefined;
}

const CLASSIFIER_SYSTEM_RULES: Partial<Record<string, string>> = {
	"system:prompt_injection": injectionQuestion,
	"system:jailbreak": jailbreakQuestion,
};

function checkSystemRule(
	rule: SystemRule,
	ruleConfig: SystemRuleConfig,
	segments: TextSegment[],
	violations: RuleViolation[],
	redactions: RedactionInfo[],
): boolean {
	const action = resolveAction(ruleConfig.action, rule.redactable);
	const kind = redactionKind(rule);
	const matches = new Set<string>();
	let sample: string | undefined;

	for (const segment of segments) {
		if (rule.trustedRoles === "skip" && segment.trusted) {
			continue;
		}
		const result = rule.check(segment.content, ruleConfig);
		if (result.passed) {
			continue;
		}
		for (const match of result.matches) {
			matches.add(match);
		}
		sample ??= sanitizeSample(segment.content, kind, ruleConfig.entities);
		if (action === "redact" && kind) {
			redactions.push({
				ruleId: rule.id,
				messageIndex: segment.messageIndex,
				kind,
				matches: [],
				...(kind === "pii" && ruleConfig.entities
					? { entities: ruleConfig.entities }
					: {}),
				pattern: result.matches.join(", "),
			});
		}
	}

	if (matches.size === 0) {
		return false;
	}
	violations.push({
		ruleId: rule.id,
		ruleName: rule.name,
		category: rule.category,
		action,
		matchedPattern: [...matches].join(", "),
		matchedContent: sample,
	});
	return true;
}

interface CustomRuleRow {
	id: string;
	name: string;
	type: string;
	config: unknown;
	action: GuardrailAction;
	enabled: boolean;
}

function checkCustomRule(
	rule: CustomRuleRow,
	segments: TextSegment[],
	violations: RuleViolation[],
	redactions: RedactionInfo[],
	questions: Map<string, PendingQuestion>,
): void {
	switch (rule.type) {
		case "classifier": {
			const config = rule.config as ClassifierRuleConfig;
			if (!config.instructions?.trim()) {
				return;
			}
			questions.set(`rule:${rule.id}`, {
				ruleId: rule.id,
				ruleName: rule.name,
				category: rule.type,
				action: resolveAction(rule.action, false),
				instructions: config.instructions.trim(),
				threshold: resolveThreshold(config.threshold),
			});
			return;
		}
		case "topic_restriction": {
			const config = rule.config as TopicRestrictionRuleConfig;
			const action = resolveAction(rule.action, false);
			if (config.classifier) {
				const threshold = resolveThreshold(config.threshold);
				config.blockedTopics
					.filter((topic) => topic.trim())
					.forEach((topic, index) => {
						questions.set(`topic:${rule.id}:${index}`, {
							ruleId: rule.id,
							ruleName: rule.name,
							category: rule.type,
							action,
							instructions: `The text discusses or asks about ${topicLabel(topic)}.`,
							threshold,
							label: topic,
						});
					});
				const allowed = (config.allowedTopics ?? []).filter((topic) =>
					topic.trim(),
				);
				if (allowed.length > 0) {
					questions.set(`allowed:${rule.id}`, {
						ruleId: rule.id,
						ruleName: rule.name,
						category: rule.type,
						action,
						instructions: `The text asks about something outside these allowed topics: ${allowed.map(topicLabel).join(", ")}. Greetings, small talk and follow-up questions about an allowed topic do not qualify.`,
						threshold,
						label: "outside allowed topics",
					});
				}
				return;
			}
			collectCustomMatches(rule, action, segments, violations, redactions, {
				skipTrusted: true,
				check: (content) =>
					checkTopicRestriction(content, config, action).matches,
			});
			return;
		}
		case "sensitive_data": {
			const config = rule.config as SensitiveDataRuleConfig;
			const action = resolveAction(rule.action, true);
			collectCustomMatches(rule, action, segments, violations, redactions, {
				check: (content) => checkSensitiveData(content, config, action).matches,
				redaction: { kind: "pii", entities: config.entities },
				sanitize: (content) => sanitizeSample(content, "pii", config.entities),
			});
			return;
		}
		case "blocked_terms": {
			const config = rule.config as BlockedTermsRuleConfig;
			const action = resolveAction(rule.action, true);
			collectCustomMatches(rule, action, segments, violations, redactions, {
				check: (content) => checkBlockedTerms(content, config, action).matches,
				redaction: { kind: "mask" },
			});
			return;
		}
		case "custom_regex": {
			const config = rule.config as CustomRegexRuleConfig;
			const action = resolveAction(rule.action, true);
			collectCustomMatches(rule, action, segments, violations, redactions, {
				check: (content) => checkCustomRegex(content, config, action).matches,
				redaction: { kind: "mask" },
			});
			break;
		}
		default:
			break;
	}
}

function collectCustomMatches(
	rule: CustomRuleRow,
	action: GuardrailAction,
	segments: TextSegment[],
	violations: RuleViolation[],
	redactions: RedactionInfo[],
	options: {
		check: (content: string) => string[];
		skipTrusted?: boolean;
		redaction?: { kind: "mask" } | { kind: "pii"; entities: PiiEntity[] };
		sanitize?: (content: string) => string;
	},
): void {
	const matches = new Set<string>();
	let sample: string | undefined;

	for (const segment of segments) {
		if (options.skipTrusted && segment.trusted) {
			continue;
		}
		const found = options.check(segment.content);
		if (found.length === 0) {
			continue;
		}
		for (const match of found) {
			matches.add(match);
		}
		sample ??= options.sanitize
			? options.sanitize(segment.content)
			: truncate(segment.content);
		if (action === "redact" && options.redaction) {
			redactions.push({
				ruleId: rule.id,
				messageIndex: segment.messageIndex,
				kind: options.redaction.kind,
				matches: options.redaction.kind === "mask" ? found : [],
				...(options.redaction.kind === "pii"
					? { entities: options.redaction.entities }
					: {}),
				pattern: found.join(", "),
			});
		}
	}

	if (matches.size === 0) {
		return;
	}
	violations.push({
		ruleId: rule.id,
		ruleName: rule.name,
		category: rule.type,
		action,
		matchedPattern: [...matches].join(", "),
		matchedContent: sample,
	});
}

function buildClassifierText(segments: TextSegment[]): string {
	const text = segments
		.filter((segment) => !segment.trusted)
		.map((segment) => `${segment.role}: ${segment.content}`)
		.join("\n\n");
	return text.length > MAX_CLASSIFIER_CHARS
		? text.slice(-MAX_CLASSIFIER_CHARS)
		: text;
}

async function runClassifier(
	input: GuardrailInput,
	messages: Message[],
	questions: Map<string, PendingQuestion>,
	violations: RuleViolation[],
): Promise<ClassifierOutcome | undefined> {
	if (questions.size === 0) {
		return undefined;
	}
	// Scored after redaction, so redacted values never reach the classifier.
	const text = buildClassifierText(extractTextContent(messages));
	if (!text.trim()) {
		return { questions: 0 };
	}
	if (!input.classify) {
		return { questions: questions.size, skipped: true };
	}

	let scores: Record<string, number>;
	try {
		scores = await input.classify({
			text,
			questions: Object.fromEntries(
				[...questions].map(([id, question]) => [id, question.instructions]),
			),
		});
	} catch (error) {
		return {
			questions: questions.size,
			error: error instanceof Error ? error.message : String(error),
		};
	}

	// One violation per rule, listing every question it failed.
	const byRule = new Map<
		string,
		{ question: PendingQuestion; hits: string[] }
	>();
	for (const [id, question] of questions) {
		const score = scores[id];
		if (typeof score !== "number" || score <= question.threshold) {
			continue;
		}
		const hit = `${question.label ? `${question.label} ` : ""}score ${score.toFixed(2)}`;
		const entry = byRule.get(question.ruleId);
		if (entry) {
			entry.hits.push(hit);
		} else {
			byRule.set(question.ruleId, { question, hits: [hit] });
		}
	}
	for (const { question, hits } of byRule.values()) {
		violations.push({
			ruleId: question.ruleId,
			ruleName: question.ruleName,
			category: question.category,
			action: question.action,
			matchedPattern: `classifier: ${hits.join(", ")}`,
		});
	}
	return { questions: questions.size };
}

export async function checkGuardrails(
	input: GuardrailInput,
): Promise<GuardrailResult> {
	const scope = await resolveGuardrailScope(
		input.organizationId,
		input.projectId,
	);
	const config = scope?.config;

	// If no config exists or guardrails are disabled, allow everything
	if (!scope || !config || !config.enabled) {
		return {
			passed: true,
			blocked: false,
			violations: [],
			redactions: [],
			rulesChecked: 0,
		};
	}

	const violations: RuleViolation[] = [];
	const redactions: RedactionInfo[] = [];
	const questions = new Map<string, PendingQuestion>();
	let rulesChecked = 0;

	const segments = extractTextContent(input.messages);

	for (const rule of systemRules) {
		const ruleConfig = config.systemRules[systemRuleKey(rule)];
		if (!ruleConfig?.enabled) {
			continue;
		}
		rulesChecked++;

		const flagged = checkSystemRule(
			rule,
			ruleConfig,
			segments,
			violations,
			redactions,
		);
		const question = CLASSIFIER_SYSTEM_RULES[rule.id];
		// A pattern hit already decides the rule; skip the paid check.
		if (question && ruleConfig.classifier && !flagged) {
			questions.set(systemRuleKey(rule), {
				ruleId: rule.id,
				ruleName: rule.name,
				category: rule.category,
				action: resolveAction(ruleConfig.action, false),
				instructions: question,
				threshold: resolveThreshold(ruleConfig.threshold),
			});
		}
	}

	const filesConfig = config.systemRules.file_types;
	if (filesConfig.enabled) {
		rulesChecked++;
		const matches = checkMessageFiles(input.messages, config);
		if (matches.length > 0) {
			violations.push({
				ruleId: fileTypesRule.id,
				ruleName: fileTypesRule.name,
				category: fileTypesRule.category,
				action: resolveAction(filesConfig.action, false),
				matchedPattern: matches.join(", "),
			});
		}
	}

	const harmfulConfig = config.systemRules.harmful_content;
	if (harmfulConfig.enabled) {
		rulesChecked++;
		const threshold = resolveThreshold(harmfulConfig.threshold);
		for (const [category, instructions] of Object.entries(
			harmfulContentQuestions,
		)) {
			questions.set(`harmful_content:${category}`, {
				ruleId: harmfulContentRule.id,
				ruleName: harmfulContentRule.name,
				category: harmfulContentRule.category,
				action: resolveAction(harmfulConfig.action, false),
				instructions,
				threshold,
				label: category,
			});
		}
	}

	const customRules = await getGuardrailRules(input.organizationId, scope);
	for (const rule of customRules) {
		if (!rule.enabled) {
			continue;
		}
		rulesChecked++;
		checkCustomRule(rule, segments, violations, redactions, questions);
	}

	const classifier = await runClassifier(
		input,
		applyRedactions(input.messages, redactions),
		questions,
		violations,
	);

	return {
		passed: violations.length === 0,
		blocked: violations.some((v) => v.action === "block"),
		violations,
		redactions,
		rulesChecked,
		...(classifier ? { classifier } : {}),
	};
}

export async function logViolation(
	organizationId: string,
	violation: RuleViolation,
	metadata?: {
		logId?: string;
		apiKeyId?: string;
		model?: string;
		contentHash?: string;
		retainSensitiveContent?: boolean;
	},
): Promise<void> {
	const retainSensitiveContent = metadata?.retainSensitiveContent !== false;
	await db.insert(guardrailViolation).values({
		organizationId,
		ruleId: violation.ruleId,
		ruleName: violation.ruleName,
		category: violation.category,
		actionTaken:
			violation.action === "block"
				? "blocked"
				: violation.action === "redact"
					? "redacted"
					: "warned",
		matchedPattern: retainSensitiveContent
			? violation.matchedPattern
			: undefined,
		matchedContent: retainSensitiveContent
			? violation.matchedContent
			: undefined,
		logId: metadata?.logId,
		apiKeyId: metadata?.apiKeyId,
		model: metadata?.model,
		contentHash: metadata?.contentHash,
	});
}

export function applyRedactions(
	messages: Message[],
	redactions: RedactionInfo[],
): Message[] {
	if (redactions.length === 0) {
		return messages;
	}

	return messages.map((message, index) => {
		const messageRedactions = redactions.filter(
			(r) => r.messageIndex === index,
		);
		if (messageRedactions.length === 0) {
			return message;
		}

		const piiRedactions = messageRedactions.filter((r) => r.kind === "pii");
		// Unset entities on any redaction means every entity.
		const piiEntities = piiRedactions.some((r) => !r.entities)
			? undefined
			: [...new Set(piiRedactions.flatMap((r) => r.entities ?? []))];
		const hasSecrets = messageRedactions.some((r) => r.kind === "secrets");
		const maskMatches = messageRedactions
			.filter((r) => r.kind === "mask")
			.flatMap((r) => r.matches);

		const redactText = (text: string): string => {
			let result = text;
			if (piiRedactions.length > 0) {
				result = redactPii(result, piiEntities).redacted;
			}
			if (hasSecrets) {
				result = redactSecrets(result).redacted;
			}
			for (const match of maskMatches) {
				result = maskMatch(result, match);
			}
			return result;
		};

		if (typeof message.content === "string") {
			return { ...message, content: redactText(message.content) };
		}
		if (!Array.isArray(message.content)) {
			return message;
		}

		const content = message.content.map((part) => {
			if (part.type === "text" && part.text) {
				return { ...part, text: redactText(part.text) };
			}
			if (part.type === "tool_result") {
				return { ...part, content: redactToolResult(part.content, redactText) };
			}
			return part;
		});

		return { ...message, content };
	});
}

function redactToolResult(
	content: unknown,
	redactText: (text: string) => string,
): unknown {
	if (typeof content === "string") {
		return redactText(content);
	}
	if (Array.isArray(content)) {
		return content.map((block: unknown) =>
			isTextBlock(block) ? { ...block, text: redactText(block.text) } : block,
		);
	}
	return content;
}

function isTextBlock(block: unknown): block is { type: "text"; text: string } {
	return (
		typeof block === "object" &&
		block !== null &&
		(block as { type?: unknown }).type === "text" &&
		typeof (block as { text?: unknown }).text === "string"
	);
}

function maskMatch(content: string, match: string): string {
	if (!match || !match.trim()) {
		return content;
	}
	const regex = new RegExp(escapeRegex(match), "gi");
	return content.replace(regex, (m) => "*".repeat(m.length));
}

function extractTextContent(messages: Message[]): TextSegment[] {
	const results: TextSegment[] = [];

	messages.forEach((message, messageIndex) => {
		const role = message.role;
		const trusted = TRUSTED_ROLES.has(role);
		const push = (content: string) => {
			if (content) {
				results.push({ content, messageIndex, role, trusted });
			}
		};

		if (typeof message.content === "string") {
			push(message.content);
			return;
		}
		if (!Array.isArray(message.content)) {
			return;
		}
		for (const part of message.content) {
			if (part.type === "text" && part.text) {
				push(part.text);
			} else if (part.type === "tool_result") {
				if (typeof part.content === "string") {
					push(part.content);
				} else if (Array.isArray(part.content)) {
					for (const block of part.content as unknown[]) {
						if (isTextBlock(block)) {
							push(block.text);
						}
					}
				}
			}
		}
	});

	return results;
}
