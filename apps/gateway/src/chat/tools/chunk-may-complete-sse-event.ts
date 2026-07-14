/**
 * Cheap per-chunk gate used by the streaming SSE parser to decide whether a
 * newly received network chunk could possibly complete a buffered SSE event.
 *
 * After every scan of the streaming buffer, the unconsumed remainder is an
 * incomplete event. A new chunk can only turn it into a complete one if the
 * chunk contains a newline (SSE event boundaries require one) or if it ends
 * with "}" or "]" ignoring trailing whitespace (the only way the parser
 * accepts a newline-less event is when its JSON payload just closed). If
 * neither holds, rescanning the buffer is guaranteed to find nothing, so the
 * caller can skip the O(buffer) scan entirely. This keeps accumulation of
 * large single events (multi-MB base64 image data) O(n) instead of O(n²).
 */
export function chunkMayCompleteSseEvent(chunk: string): boolean {
	if (chunk.includes("\n")) {
		return true;
	}
	for (let i = chunk.length - 1; i >= 0; i--) {
		const c = chunk[i];
		if (c === "}" || c === "]") {
			return true;
		}
		if (c !== " " && c !== "\t" && c !== "\r") {
			return false;
		}
	}
	return false;
}
