import { compileGuardrailRegex } from "./compile-regex.js";

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
		const matches =
			compileGuardrailRegex(config.pattern)
				.match(content)
				?.filter((match): match is string => typeof match === "string") ?? [];
		return { passed: matches.length === 0, matches, action };
	} catch {
		return {
			passed: false,
			matches: ["Invalid guardrail regex configuration"],
			action: "block",
		};
	}
}
