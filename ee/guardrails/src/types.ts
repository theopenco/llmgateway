import type {
	GuardrailAction,
	SystemRuleConfig,
	SystemRulesConfig,
} from "@llmgateway/db";

export type SystemRuleId =
	| "system:prompt_injection"
	| "system:jailbreak"
	| "system:pii_detection"
	| "system:secrets"
	| "system:file_types"
	| "system:document_leakage";

export interface GuardrailConfigData {
	enabled: boolean;
	systemRules: SystemRulesConfig;
	maxFileSizeMb: number;
	allowedFileTypes: string[];
	piiAction: GuardrailAction;
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
	pattern: string;
	replacement: string;
	messageIndex: number;
	originalContent: string;
}

export interface GuardrailResult {
	passed: boolean;
	blocked: boolean;
	violations: RuleViolation[];
	redactions: RedactionInfo[];
	rulesChecked: number;
}

export interface Message {
	role: string;
	content: string | MessageContent[];
}

export interface MessageContent {
	type: string;
	text?: string;
	image_url?: {
		url: string;
	};
}

export interface FileInfo {
	name: string;
	type: string;
	size: number;
}

export interface GuardrailInput {
	organizationId: string;
	messages: Message[];
	files?: FileInfo[];
}

export interface SystemRule {
	id: SystemRuleId;
	name: string;
	category: string;
	defaultEnabled: boolean;
	defaultAction: GuardrailAction;
	check: (
		content: string,
		config: SystemRuleConfig,
	) => {
		passed: boolean;
		matches: string[];
	};
}
