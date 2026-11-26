import { detectPii } from "@/rules/system/pii.js";

import type { GuardrailAction, SensitiveDataRuleConfig } from "@llmgateway/db";

export interface SensitiveDataResult {
	passed: boolean;
	/** Detector labels, never the matched values. */
	matches: string[];
	action: GuardrailAction;
}

export function checkSensitiveData(
	content: string,
	config: SensitiveDataRuleConfig,
	action: GuardrailAction,
): SensitiveDataResult {
	if (config.entities.length === 0) {
		return { passed: true, matches: [], action };
	}
	const { patterns } = detectPii(content, config.entities);
	return {
		passed: patterns.length === 0,
		matches: [...new Set(patterns)],
		action,
	};
}
