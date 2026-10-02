import { matchGuardrailRegex } from "./compile-regex.js";
import { createLiteralRegex } from "./literal-regex.js";

import type { BlockedTermsRuleConfig, GuardrailAction } from "@llmgateway/db";

export interface BlockedTermsResult {
	passed: boolean;
	matches: string[];
	action: GuardrailAction;
}

export function checkBlockedTerms(
	content: string,
	config: BlockedTermsRuleConfig,
	action: GuardrailAction,
): BlockedTermsResult {
	const matches: string[] = [];
	const searchContent = config.caseSensitive ? content : content.toLowerCase();

	for (const term of config.terms) {
		// Skip empty or whitespace-only terms
		if (!term || !term.trim()) {
			continue;
		}

		const searchTerm = config.caseSensitive ? term : term.toLowerCase();

		switch (config.matchType) {
			case "exact": {
				const found = content.match(
					createLiteralRegex(term, config.caseSensitive, true),
				);
				if (found) {
					matches.push(...found.map(() => term));
				}
				break;
			}
			case "contains": {
				if (searchContent.includes(searchTerm)) {
					matches.push(term);
				}
				break;
			}
			case "regex": {
				try {
					matches.push(
						...matchGuardrailRegex(term, content, config.caseSensitive),
					);
				} catch {
					return {
						passed: false,
						matches: ["Invalid guardrail regex configuration"],
						action: "block",
					};
				}
				break;
			}
		}
	}

	return {
		passed: matches.length === 0,
		matches,
		action,
	};
}
