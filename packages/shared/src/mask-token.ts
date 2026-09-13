const MIN_MASKED_CHARS = 4;

/**
 * Bullets rendered for the hidden part, however long that part actually is.
 * One bullet per hidden character turns a service-account JSON into hundreds
 * of them, which wrecks any table the value appears in and publishes the
 * token's exact length to anyone reading the page.
 */
const MAX_MASK_BULLETS = 5;

/**
 * Returns a display-safe token with at least MIN_MASKED_CHARS hidden.
 * Optional trailing characters take priority over the prefix on short tokens.
 *
 * Empty input returns empty.
 */
export function maskToken(
	token: string,
	visibleChars = 12,
	trailingChars = 0,
): string {
	if (token.length === 0) {
		return "";
	}
	const effectiveTrailing = Math.max(
		0,
		Math.min(trailingChars, token.length - MIN_MASKED_CHARS),
	);
	const effectiveVisible = Math.max(
		0,
		Math.min(visibleChars, token.length - effectiveTrailing - MIN_MASKED_CHARS),
	);
	const maskedLength = Math.max(
		token.length - effectiveVisible - effectiveTrailing,
		MIN_MASKED_CHARS,
	);
	return `${token.substring(0, effectiveVisible)}${"\u2022".repeat(
		Math.min(maskedLength, MAX_MASK_BULLETS),
	)}${token.substring(token.length - effectiveTrailing)}`;
}
