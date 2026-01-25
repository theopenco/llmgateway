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
	const matches: string[] = [];

	try {
		const regex = new RegExp(config.pattern, "gi");
		const found = content.match(regex);
		if (found) {
			matches.push(...found);
		}
	} catch {
		// Invalid regex, pass through
	}

	return {
		passed: matches.length === 0,
		matches,
		action,
	};
}
