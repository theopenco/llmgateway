// Search terms and stored matchers are plain substrings, so LIKE
// metacharacters must be escaped before wrapping them in wildcards. For the
// organization search this is a safety guard, not just correctness: an
// unescaped "%" would silently become a match-everything filter, and the bulk
// block endpoint reuses that filter to decide which organizations get banned.
export function escapeLikePattern(value: string): string {
	return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}
