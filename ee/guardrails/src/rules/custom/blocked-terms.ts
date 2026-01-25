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
				const regex = new RegExp(`\\b${escapeRegex(searchTerm)}\\b`, "g");
				const found = searchContent.match(regex);
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
					const regex = new RegExp(term, config.caseSensitive ? "g" : "gi");
					const found = content.match(regex);
					if (found) {
						matches.push(...found);
					}
				} catch {
					// Invalid regex, skip
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

function escapeRegex(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
