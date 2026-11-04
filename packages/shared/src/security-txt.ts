const SECURITY_TXT_TTL_MS = 180 * 24 * 60 * 60 * 1000;

/**
 * RFC 9116 security.txt served at /.well-known/security.txt. `Expires` is
 * derived from `now` (rounded to the UTC day) so the file never goes stale.
 */
export function buildSecurityTxt(now: Date = new Date()): string {
	const today = Date.UTC(
		now.getUTCFullYear(),
		now.getUTCMonth(),
		now.getUTCDate(),
	);
	const expires = new Date(today + SECURITY_TXT_TTL_MS);
	return [
		"Contact: https://github.com/theopenco/llmgateway/security/advisories/new",
		"Contact: mailto:contact@llmgateway.io",
		`Expires: ${expires.toISOString()}`,
		"Policy: https://github.com/theopenco/llmgateway/blob/main/SECURITY.md",
		"Preferred-Languages: en",
		"",
	].join("\n");
}
