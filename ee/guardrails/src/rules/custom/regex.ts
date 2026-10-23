import { matchGuardrailRegex } from "./compile-regex.js";

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
	try {
		const matches = matchGuardrailRegex(config.pattern, content);
		return { passed: matches.length === 0, matches, action };
	} catch {
		return {
			passed: false,
			matches: ["Invalid guardrail regex configuration"],
			action: "block",
		};
	}
}
