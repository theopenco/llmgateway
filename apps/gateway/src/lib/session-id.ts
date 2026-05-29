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
 * Claude Code populates `metadata.user_id` with a structured string that embeds
 * the session UUID, e.g. `user_<hash>_account_<hash>_session_<uuid>`. We pull
 * out the `session_<uuid>` segment so the key is stable per conversation rather
 * than per user. When no session segment is present we fall back to the whole
 * value, which is still stable for the caller.
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
	const match = trimmed.match(/session_[A-Za-z0-9-]+/);
	return match ? match[0] : trimmed;
}
