// Maximum pattern length to prevent resource exhaustion
const MAX_PATTERN_LENGTH = 1000;

// Patterns that can cause catastrophic backtracking (ReDoS)
// These detect nested quantifiers like (a+)+, (a*)+, (a+)*, etc.
const REDOS_PATTERNS = [
	/\([^)]*[+*][^)]*\)[+*]/, // (x+)+ or (x*)+ patterns
	/\([^)]*\)\{[^}]+\}[+*]/, // (x){n}+ patterns
	/\([^)]*[+*][^)]*\)\{\d+,\d*\}/, // (x+){n,} and (x+){n,m} patterns
];

/**
 * Compiles a user-supplied pattern, or returns null when it is invalid or
 * could backtrack catastrophically (ReDoS).
 */
export function compileUserRegex(
	pattern: string,
	flags: string,
): RegExp | null {
	if (!pattern || pattern.length > MAX_PATTERN_LENGTH) {
		return null;
	}
	if (REDOS_PATTERNS.some((dangerous) => dangerous.test(pattern))) {
		return null;
	}
	try {
		return new RegExp(pattern, flags);
	} catch {
		return null;
	}
}

export function escapeRegex(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
