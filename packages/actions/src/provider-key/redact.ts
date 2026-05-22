/**
 * Removes occurrences of a known plaintext token from arbitrary text.
 *
 * Upstream provider validation errors sometimes echo back the submitted
 * key in their error body; the same message then flows through to logs
 * and the client-facing 400 response. Any code path that holds both
 * the plaintext token and an error string MUST funnel through this
 * helper before logging or returning to the client.
 *
 * The redaction is intentionally exact-substring only. We do not try
 * to detect arbitrary key shapes (sk-..., etc.) because that would either
 * miss real keys (different providers use different formats) or false-positive
 * on unrelated text. The caller already knows the plaintext.
 */
export function redactToken(
	text: string | undefined | null,
	plaintextToken: string | undefined | null,
): string {
	if (!text) {
		return "";
	}
	if (!plaintextToken) {
		return text;
	}
	const placeholder = "[REDACTED_TOKEN]";
	// Split-and-join avoids regex escaping pitfalls when tokens contain
	// special characters (custom providers can have anything).
	return text.split(plaintextToken).join(placeholder);
}
