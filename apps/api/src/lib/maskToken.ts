const MIN_MASKED_CHARS = 4;

/**
 * Returns a display-safe version of a secret token. The trailing
 * MIN_MASKED_CHARS characters are always replaced with bullets so a short
 * token (e.g. a custom-provider key shorter than visibleChars) cannot leak
 * through as plaintext into provider_key.token_masked or UI list responses.
 *
 * Empty input returns empty (callers pass row.token ?? "" for legacy rows
 * that may have a null token; that's expected).
 */
export function maskToken(token: string, visibleChars = 12): string {
	if (token.length === 0) {
		return "";
	}
	const effectiveVisible = Math.max(
		0,
		Math.min(visibleChars, token.length - MIN_MASKED_CHARS),
	);
	const maskedLength = Math.max(
		token.length - effectiveVisible,
		MIN_MASKED_CHARS,
	);
	return `${token.substring(0, effectiveVisible)}${"\u2022".repeat(maskedLength)}`;
}
