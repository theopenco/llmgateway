import { swrWrap } from "@llmgateway/cache";
import {
	cdb,
	db,
	getTableName,
	guardrailConfig,
	guardrailRule,
	guardrailViolation,
	defaultSystemRulesConfig,
	defaultAllowedFileTypes,
	and,
	eq,
	desc,
	isNull,
} from "@llmgateway/db";

import { createLiteralRegex } from "./rules/custom/literal-regex.js";
import {
	systemRules,
	redactPii,
	redactSecrets,
	checkBlockedTerms,
	checkCustomRegex,
	checkTopicRestriction,
} from "./rules/index.js";
import { checkFileType, checkFileSize } from "./rules/system/files.js";

import type {
	GuardrailInput,
	GuardrailResult,
	RuleViolation,
	RedactionInfo,
	GuardrailConfigData,
	GuardrailScope,
	Message,
} from "./types.js";
import type {
	SystemRulesConfig,
	BlockedTermsRuleConfig,
	CustomRegexRuleConfig,
	TopicRestrictionRuleConfig,
	GuardrailAction,
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
				piiAction: GuardrailAction | null;
		  }
		| undefined,
): GuardrailConfigData | null {
	if (!config) {
		return null;
	}

	return {
		enabled: config.enabled,
		systemRules: config.systemRules ?? defaultSystemRulesConfig,
		maxFileSizeMb: config.maxFileSizeMb,
		allowedFileTypes: config.allowedFileTypes ?? defaultAllowedFileTypes,
		piiAction: config.piiAction ?? "redact",
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
	let rulesChecked = 0;

	// Extract text content from messages
	const textContents = extractTextContent(input.messages);

	// Check system rules
	for (const rule of systemRules) {
		const ruleKey = rule.id.replace("system:", "") as keyof SystemRulesConfig;
		const ruleConfig = config.systemRules[ruleKey];

		if (!ruleConfig || !ruleConfig.enabled) {
			continue;
		}

		rulesChecked++;

		for (const { content, messageIndex } of textContents) {
			const result = rule.check(content, ruleConfig, config.allowedFileTypes);

			if (!result.passed) {
				// The PII and secrets rules report detector labels rather than
				// matched values, so neither field may carry the content those
				// rules exist to keep out of storage.
				let matchedContent = content;
				let kind: RedactionInfo["kind"] | undefined;

				if (rule.id === "system:pii_detection") {
					matchedContent = redactPii(matchedContent).redacted;
					kind = "pii";
				} else if (rule.id === "system:secrets") {
					matchedContent = redactSecrets(matchedContent).redacted;
					kind = "secrets";
				}

				if (ruleConfig.action === "redact" && kind) {
					redactions.push({
						ruleId: rule.id,
						messageIndex,
						kind,
						matches: [],
						pattern: result.matches.join(", "),
					});
				}

				violations.push({
					ruleId: rule.id,
					ruleName: rule.name,
					category: rule.category,
					action: ruleConfig.action,
					matchedPattern: result.matches.join(", "),
					matchedContent: matchedContent.substring(0, 100),
				});
			}
		}
	}

	const fileRule = config.systemRules.file_types;
	if (fileRule?.enabled) {
		const files = [...(input.files ?? [])];
		for (const message of input.messages) {
			if (!Array.isArray(message.content)) {
				continue;
			}
			for (const part of message.content) {
				if (part.type === "text") {
					continue;
				}
				if (part.input_audio) {
					const format = part.input_audio.format.toLowerCase();
					files.push({
						name: "audio",
						type: `audio/${format === "mp3" || format === "mpga" ? "mpeg" : format === "m4a" ? "mp4" : format}`,
						size: Buffer.byteLength(part.input_audio.data, "base64"),
					});
					continue;
				}
				const data = part.image_url?.url ?? part.file?.file_data;
				if (!part.image_url && !part.file) {
					continue;
				}
				const comma = data?.indexOf(",") ?? -1;
				const header = data?.slice(0, Math.max(0, comma));
				let type = "unknown";
				let size = 0;
				if (header?.slice(0, 5).toLowerCase() === "data:") {
					type = header.slice(5).split(";")[0].toLowerCase();
					const payload = data!.slice(comma + 1);
					try {
						size = /;base64$/i.test(header)
							? Buffer.byteLength(payload, "base64")
							: Buffer.byteLength(decodeURIComponent(payload));
					} catch {
						type = "unknown";
					}
				}
				files.push({ name: part.file?.filename ?? "attachment", type, size });
			}
		}
		for (const file of files) {
			const invalidType = !checkFileType(file.type, config.allowedFileTypes);
			const invalidSize = !checkFileSize(
				file.size / (1024 * 1024),
				config.maxFileSizeMb,
			);
			if (invalidType || invalidSize) {
				violations.push({
					ruleId: "system:file_types",
					ruleName: "File Type Restrictions",
					category: "files",
					action: fileRule.action === "redact" ? "block" : fileRule.action,
					matchedPattern: invalidType
						? `Blocked file type: ${file.type}`
						: `File exceeds ${config.maxFileSizeMb}MB`,
				});
			}
		}
	}

	// Check custom rules
	const customRules = await getGuardrailRules(input.organizationId, scope);

	for (const rule of customRules) {
		if (!rule.enabled) {
			continue;
		}

		rulesChecked++;

		for (const { content, messageIndex } of textContents) {
			let result: {
				passed: boolean;
				matches: string[];
				action: GuardrailAction;
			};

			switch (rule.type) {
				case "blocked_terms":
					result = checkBlockedTerms(
						content,
						rule.config as BlockedTermsRuleConfig,
						rule.action,
					);
					break;
				case "custom_regex":
					result = checkCustomRegex(
						content,
						rule.config as CustomRegexRuleConfig,
						rule.action,
					);
					break;
				case "topic_restriction":
					result = checkTopicRestriction(
						content,
						rule.config as TopicRestrictionRuleConfig,
						rule.action,
					);
					break;
				default:
					continue;
			}

			if (!result.passed) {
				violations.push({
					ruleId: rule.id,
					ruleName: rule.name,
					category: rule.type,
					action: result.action,
					matchedPattern: result.matches.join(", "),
					matchedContent: content.substring(0, 100),
				});

				if (result.action === "redact" && result.matches.length > 0) {
					const termsConfig =
						rule.type === "blocked_terms"
							? (rule.config as BlockedTermsRuleConfig)
							: undefined;
					redactions.push({
						ruleId: rule.id,
						messageIndex,
						kind: "mask",
						matches: result.matches,
						pattern: result.matches.join(", "),
						// Regex results already contain each match's original casing.
						caseSensitive:
							rule.type === "custom_regex" ||
							termsConfig?.matchType === "regex" ||
							termsConfig?.caseSensitive,
						wholeWord: termsConfig?.matchType === "exact",
					});
				}
			}
		}
	}

	// Determine if request should be blocked
	const blocked = violations.some((v) => v.action === "block");

	return {
		passed: violations.length === 0,
		blocked,
		violations,
		redactions,
		rulesChecked,
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

// Every match is located on the unmasked text and the covered ranges are
// merged before masking, so a match sharing a prefix or overlapping another
// is masked in full rather than leaving its tail behind.
function maskMatches(text: string, masks: RedactionInfo[]): string {
	const masked = new Uint8Array(text.length);
	for (const mask of masks) {
		// A uniform run can yield thousands of identical matches; scanning each
		// separately is quadratic in the text length.
		for (const match of new Set(mask.matches)) {
			if (!match.trim()) {
				continue;
			}
			const pattern = createLiteralRegex(
				match,
				mask.caseSensitive,
				mask.wholeWord,
			);
			let found;
			while ((found = pattern.exec(text)) !== null) {
				masked.fill(1, found.index, found.index + found[0].length);
			}
		}
	}
	const parts: string[] = [];
	let start = 0;
	while (start < text.length) {
		let end = start;
		while (end < text.length && masked[end] === masked[start]) {
			end++;
		}
		parts.push(
			masked[start] ? "*".repeat(end - start) : text.slice(start, end),
		);
		start = end;
	}
	return parts.join("");
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

		const hasPii = messageRedactions.some((r) => r.kind === "pii");
		const hasSecrets = messageRedactions.some((r) => r.kind === "secrets");
		const masks = messageRedactions.filter((r) => r.kind === "mask");

		const redactText = (text: string): string => {
			let result = text;
			if (hasPii) {
				result = redactPii(result).redacted;
			}
			if (hasSecrets) {
				result = redactSecrets(result).redacted;
			}
			return masks.length > 0 ? maskMatches(result, masks) : result;
		};

		if (typeof message.content === "string") {
			return { ...message, content: redactText(message.content) };
		}

		// Handle array content (multimodal)
		const content = message.content.map((part) => {
			if (part.type === "text" && part.text) {
				return { ...part, text: redactText(part.text) };
			}
			return part;
		});

		return { ...message, content };
	});
}

function extractTextContent(
	messages: Message[],
): { content: string; messageIndex: number }[] {
	const results: { content: string; messageIndex: number }[] = [];

	for (let i = 0; i < messages.length; i++) {
		const message = messages[i];

		if (typeof message.content === "string") {
			results.push({ content: message.content, messageIndex: i });
		} else if (Array.isArray(message.content)) {
			for (const part of message.content) {
				if (part.type === "text" && part.text) {
					results.push({ content: part.text, messageIndex: i });
				}
			}
		}
	}

	return results;
}
