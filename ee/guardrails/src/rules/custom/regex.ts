import type { CustomRegexRuleConfig, GuardrailAction } from "@llmgateway/db";

export interface RegexResult {
	passed: boolean;
	matches: string[];
	action: GuardrailAction;
}

// Maximum pattern length to prevent resource exhaustion
const MAX_PATTERN_LENGTH = 1000;

// Patterns that can cause catastrophic backtracking (ReDoS)
// These detect nested quantifiers like (a+)+, (a*)+, (a+)*, etc.
const REDOS_PATTERNS = [
	/\([^)]*[+*][^)]*\)[+*]/, // (x+)+ or (x*)+ patterns
	/\([^)]*\)\{[^}]+\}[+*]/, // (x){n}+ patterns
];

/**
 * Check if a regex pattern is potentially dangerous (could cause ReDoS)
 */
function isPotentiallyDangerous(pattern: string): boolean {
	if (pattern.length > MAX_PATTERN_LENGTH) {
		return true;
	}

	for (const dangerous of REDOS_PATTERNS) {
		if (dangerous.test(pattern)) {
			return true;
		}
	}

	return false;
}

export function checkCustomRegex(
	content: string,
	config: CustomRegexRuleConfig,
	action: GuardrailAction,
): RegexResult {
	const matches: string[] = [];

	// Skip potentially dangerous patterns
	if (isPotentiallyDangerous(config.pattern)) {
		return {
			passed: true,
			matches: [],
			action,
		};
	}

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
