import { defaultSystemRulesConfig } from "@llmgateway/db";

import type { GuardrailAction, SystemRulesConfig } from "@llmgateway/db";

export interface SystemRuleInfo {
	id: `system:${keyof SystemRulesConfig}`;
	name: string;
	category: string;
	defaultEnabled: boolean;
	defaultAction: GuardrailAction;
	/** Whether "redact" is a meaningful action for the rule. */
	redactable: boolean;
	/** "pattern" rules are free; "classifier" rules bill a decision request. */
	detection: "pattern" | "pattern+classifier" | "classifier";
}

const info = (
	key: keyof SystemRulesConfig,
	rest: Omit<SystemRuleInfo, "id" | "defaultEnabled" | "defaultAction">,
): SystemRuleInfo => ({
	id: `system:${key}`,
	defaultEnabled: defaultSystemRulesConfig[key].enabled,
	defaultAction: defaultSystemRulesConfig[key].action,
	...rest,
});

/** Every built-in rule with its defaults, for the API and dashboards. */
export const systemRuleCatalog: SystemRuleInfo[] = [
	info("prompt_injection", {
		name: "Prompt Injection Detection",
		category: "injection",
		redactable: false,
		detection: "pattern+classifier",
	}),
	info("jailbreak", {
		name: "Jailbreak Prevention",
		category: "jailbreak",
		redactable: false,
		detection: "pattern+classifier",
	}),
	info("pii_detection", {
		name: "PII Detection",
		category: "pii",
		redactable: true,
		detection: "pattern",
	}),
	info("secrets", {
		name: "Secrets Detection",
		category: "secrets",
		redactable: true,
		detection: "pattern",
	}),
	info("file_types", {
		name: "File Type Restrictions",
		category: "files",
		redactable: false,
		detection: "pattern",
	}),
	info("document_leakage", {
		name: "Document Leakage Prevention",
		category: "document_leakage",
		redactable: false,
		detection: "pattern",
	}),
	info("harmful_content", {
		name: "Harmful Content",
		category: "harmful_content",
		redactable: false,
		detection: "classifier",
	}),
];
