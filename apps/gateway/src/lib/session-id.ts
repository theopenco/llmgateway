/**
 * Session id resolution for sticky routing.
 *
 * The gateway pins a logical session to a single upstream provider so that
 * provider-side prompt caches stay warm across a multi-turn conversation. The
 * sticky key is sourced, in priority order, from the explicit `x-session-id`
 * header, then provider-native fields the coding agents already send.
 */

/**
 * Extract a stable session id from Anthropic's `metadata.user_id`.
 *
 * Claude Code populates `metadata.user_id` with a JSON object string, e.g.
 * `{"device_id":"...","account_uuid":"...","session_id":"<uuid>"}`. We use the
 * `session_id` field so the key is stable per conversation rather than per
 * device or account.
 *
 * For callers that instead send a structured string embedding the session
 * (e.g. `user_<hash>_account_<hash>_session_<uuid>`) we pull out the
 * `session_<uuid>` segment, and otherwise fall back to the whole value.
 */
export function extractAnthropicSessionId(
	userId: string | undefined,
): string | undefined {
	if (!userId) {
		return undefined;
	}
	const trimmed = userId.trim();
	if (!trimmed) {
		return undefined;
	}

	// Claude Code sends a JSON object string with a `session_id` field.
	if (trimmed.startsWith("{")) {
		try {
			const parsed = JSON.parse(trimmed) as { session_id?: unknown };
			if (typeof parsed.session_id === "string" && parsed.session_id.trim()) {
				return parsed.session_id.trim();
			}
			// Parsed JSON without a usable session id → no stable session key.
			return undefined;
		} catch {
			// Not valid JSON — fall through to string handling.
		}
	}

	// Structured string form: user_<hash>_account_<hash>_session_<uuid>.
	const match = trimmed.match(/session_[A-Za-z0-9-]+/);
	return match ? match[0] : trimmed;
}
