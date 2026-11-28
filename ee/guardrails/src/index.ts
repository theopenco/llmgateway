export {
	checkGuardrails,
	getGuardrailConfig,
	resolveGuardrailScope,
	logViolation,
	applyRedactions,
} from "./engine.js";

export type {
	ClassifierOutcome,
	ClassifierRequest,
	GuardrailClassifier,
	GuardrailConfigData,
	GuardrailScope,
	RuleViolation,
	RedactionInfo,
	GuardrailResult,
	GuardrailInput,
	Message,
	MessageContent,
	SystemRule,
	SystemRuleId,
} from "./types.js";

export { systemRules, presetTopics } from "./rules/index.js";
export { systemRuleCatalog } from "./catalog.js";
export { userRegexError } from "./rules/safe-regex.js";

// Re-export db types for convenience
export type {
	GuardrailAction,
	PiiEntity,
	SystemRuleConfig,
	SystemRulesConfig,
	BlockedTermsRuleConfig,
	ClassifierRuleConfig,
	CustomRegexRuleConfig,
	SensitiveDataRuleConfig,
	TopicRestrictionRuleConfig,
	CustomRuleConfig,
	GuardrailActionTaken,
	CustomRuleType,
} from "@llmgateway/db";

export {
	guardrailConfig,
	guardrailRule,
	guardrailViolation,
	defaultSystemRulesConfig,
	defaultAllowedFileTypes,
	piiEntities,
} from "@llmgateway/db";
