import { compileUserRegex } from "@/rules/safe-regex.js";

import type { CustomRegexRuleConfig, GuardrailAction } from "@llmgateway/db";

export interface RegexResult {
	passed: boolean;
	matches: string[];
	action: GuardrailAction;
}

export function checkCustomRegex(
	content: string,
	config: CustomRegexRuleConfig,
	action: GuardrailAction,
): RegexResult {
	// Invalid or potentially catastrophic patterns never match.
	const regex = compileUserRegex(config.pattern, "gi");
	const matches = regex ? [...(content.match(regex) ?? [])] : [];

	return {
		passed: matches.length === 0,
		matches,
		action,
	};
}
