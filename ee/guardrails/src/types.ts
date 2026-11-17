import type {
	GuardrailAction,
	PiiEntity,
	SystemRuleConfig,
	SystemRulesConfig,
} from "@llmgateway/db";

export type SystemRuleId =
	| "system:prompt_injection"
	| "system:jailbreak"
	| "system:pii_detection"
	| "system:secrets"
	| "system:file_types"
	| "system:document_leakage"
	| "system:harmful_content";

export interface GuardrailConfigData {
	enabled: boolean;
	systemRules: SystemRulesConfig;
	maxFileSizeMb: number;
	allowedFileTypes: string[];
	/** Decision model the classifier rules run on. */
	classifierModel: string;
}

export interface GuardrailScope {
	config: GuardrailConfigData;
	/** The project owning this config, or null when the organization config applies. */
	projectId: string | null;
}

export interface RuleViolation {
	ruleId: string;
	ruleName: string;
	category: string;
	action: GuardrailAction;
	matchedPattern?: string;
	matchedContent?: string;
}

export interface RedactionInfo {
	ruleId: string;
	messageIndex: number;
	// "pii"/"secrets" apply the built-in detectors' redaction; "mask" replaces literal matches with asterisks
	kind: "pii" | "secrets" | "mask";
	// Literal substrings to mask out (used when kind is "mask")
	matches: string[];
	/** "pii" only: entities to redact. Unset redacts every entity. */
	entities?: PiiEntity[];
	// Matched patterns, for reference/logging
	pattern: string;
}

export interface ClassifierRequest {
	/** Decision model to score with. */
	model: string;
	/** Untrusted conversation text to score. */
	text: string;
	/** Question id to a yes/no criterion the text is scored against. */
	questions: Record<string, string>;
}

/**
 * Scores text against yes/no criteria and returns a 0–1 probability per
 * question id. Injected by the caller so the engine stays transport-agnostic.
 */
export type GuardrailClassifier = (
	request: ClassifierRequest,
) => Promise<Record<string, number>>;

export interface ClassifierOutcome {
	/** Questions the enabled rules asked. */
	questions: number;
	/** Set when classifier rules were enabled but no classifier was available. */
	skipped?: boolean;
	/** Set when the classifier call failed; the request then fails open. */
	error?: string;
}

export interface GuardrailResult {
	passed: boolean;
	blocked: boolean;
	violations: RuleViolation[];
	redactions: RedactionInfo[];
	rulesChecked: number;
	classifier?: ClassifierOutcome;
}

export interface Message {
	role: string;
	content: string | MessageContent[] | null;
}

export interface MessageContent {
	type: string;
	text?: string;
	image_url?: {
		url: string;
	};
	source?: { media_type?: string; data?: string };
	input_audio?: { data?: string; format?: string };
	file?: { filename?: string; file_data?: string };
	/** tool_result blocks */
	content?: unknown;
}

export interface GuardrailInput {
	organizationId: string;
	/** When set, a project-level override replaces the organization config. */
	projectId?: string;
	messages: Message[];
	/** Enables classifier-backed rules; without it they are skipped. */
	classify?: GuardrailClassifier;
}

export interface SystemRule {
	id: SystemRuleId;
	name: string;
	category: string;
	defaultEnabled: boolean;
	defaultAction: GuardrailAction;
	/** Whether a "redact" action can be honoured; otherwise it blocks. */
	redactable: boolean;
	/** "skip" leaves system/developer messages unscanned. */
	trustedRoles: "scan" | "skip";
	check: (
		content: string,
		config: SystemRuleConfig,
	) => {
		passed: boolean;
		matches: string[];
	};
}
