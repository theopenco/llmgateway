/**
 * Parse an upstream error a provider wrote as a raw (non-SSE) JSON tail before
 * closing a streaming response. The Gemini API sheds Flex-tier capacity this
 * way mid-stream: an HTTP 200 SSE stream ends with a bare
 * `{"error": {"code": 503, "message": "...", "status": "UNAVAILABLE"}}` body
 * instead of a terminal data event, so the real cause sits unparsed in the
 * gateway's leftover stream buffer.
 *
 * Returns the `error` object only when everything after the buffer's last SSE
 * event separator (blank line) is exactly one complete JSON object carrying an
 * object `error` member with a non-empty string `message`. Partial SSE frames,
 * truncated JSON, or any other tail shape yields null so callers fall back to
 * the generic truncation error.
 */
export function parseTrailingUpstreamError(
	buffer: string,
): Record<string, unknown> | null {
	// The leftover buffer may still hold trailing lines of the last consumed
	// SSE frame (e.g. "\nid: 1\n\n") ahead of the raw error tail — everything
	// before the final blank-line separator belongs to SSE framing, not to the
	// provider's closing error body.
	let tail = buffer;
	const separators = buffer.matchAll(/\r?\n\r?\n/g);
	for (const separator of separators) {
		tail = buffer.slice(separator.index + separator[0].length);
	}
	const trimmed = tail.trim();
	if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
		return null;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(trimmed);
	} catch {
		return null;
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		return null;
	}
	const error = (parsed as { error?: unknown }).error;
	if (!error || typeof error !== "object" || Array.isArray(error)) {
		return null;
	}
	const message = (error as { message?: unknown }).message;
	if (typeof message !== "string" || message.length === 0) {
		return null;
	}
	return error as Record<string, unknown>;
}
