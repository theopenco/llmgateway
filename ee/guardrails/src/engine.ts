import {
	db,
	guardrailConfig,
	guardrailRule,
	guardrailViolation,
	defaultSystemRulesConfig,
	defaultAllowedFileTypes,
	eq,
	desc,
} from "@llmgateway/db";

import {
	systemRules,
	redactPii,
	checkBlockedTerms,
	checkCustomRegex,
	checkTopicRestriction,
} from "./rules/index.js";

import type {
	GuardrailInput,
	GuardrailResult,
	RuleViolation,
	RedactionInfo,
	GuardrailConfigData,
	Message,
} from "./types.js";
import type {
	SystemRulesConfig,
	BlockedTermsRuleConfig,
	CustomRegexRuleConfig,
	TopicRestrictionRuleConfig,
	GuardrailAction,
} from "@llmgateway/db";

export async function getGuardrailConfig(
	organizationId: string,
): Promise<GuardrailConfigData | null> {
	const configs = await db
		.select()
		.from(guardrailConfig)
		.where(eq(guardrailConfig.organizationId, organizationId))
		.limit(1);

	const config = configs[0];

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

export async function checkGuardrails(
	input: GuardrailInput,
): Promise<GuardrailResult> {
	const config = await getGuardrailConfig(input.organizationId);

	// If no config exists or guardrails are disabled, allow everything
	if (!config || !config.enabled) {
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
			const result = rule.check(content, ruleConfig);

			if (!result.passed) {
				// Handle PII redaction specially
				if (
					rule.id === "system:pii_detection" &&
					ruleConfig.action === "redact"
				) {
					const { patterns } = redactPii(content);
					for (const pattern of patterns) {
						redactions.push({
							ruleId: rule.id,
							pattern,
							replacement: `[${pattern.toUpperCase()}_REDACTED]`,
							messageIndex,
							originalContent: content,
						});
					}
					// Also add as violation for logging
					violations.push({
						ruleId: rule.id,
						ruleName: rule.name,
						category: rule.category,
						action: ruleConfig.action,
						matchedPattern: patterns.join(", "),
						matchedContent: content.substring(0, 100),
					});
				} else {
					violations.push({
						ruleId: rule.id,
						ruleName: rule.name,
						category: rule.category,
						action: ruleConfig.action,
						matchedPattern: result.matches.join(", "),
						matchedContent: content.substring(0, 100),
					});
				}
			}
		}
	}

	// Check custom rules
	const customRules = await db
		.select()
		.from(guardrailRule)
		.where(eq(guardrailRule.organizationId, input.organizationId))
		.orderBy(desc(guardrailRule.priority));

	for (const rule of customRules) {
		if (!rule.enabled) {
			continue;
		}

		rulesChecked++;

		for (const { content } of textContents) {
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
	},
): Promise<void> {
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
		matchedPattern: violation.matchedPattern,
		matchedContent: violation.matchedContent,
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

		if (typeof message.content === "string") {
			let content = message.content;
			// Apply PII redaction
			const { redacted } = redactPii(content);
			content = redacted;
			return { ...message, content };
		}

		// Handle array content (multimodal)
		const content = message.content.map((part) => {
			if (part.type === "text" && part.text) {
				const { redacted } = redactPii(part.text);
				return { ...part, text: redacted };
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
