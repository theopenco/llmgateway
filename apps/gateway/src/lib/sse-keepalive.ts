/**
 * SSE keepalive helper.
 *
 * Long-running streaming completions (reasoning models, slow providers, cold
 * starts) can go many seconds without emitting a body byte while the upstream
 * is still "thinking". Intermediaries (load balancers, reverse proxies, client
 * HTTP stacks) enforce a read-idle timeout on the response body and will reset
 * the socket if no bytes flow within that window, surfacing to the caller as
 * "The socket connection was closed unexpectedly". Periodically writing an SSE
 * comment resets those idle timers and keeps the stream warm.
 */

export const DEFAULT_SSE_KEEPALIVE_INTERVAL_MS = 15000;

/**
 * Resolves the keepalive interval. Operators sitting behind a proxy with an
 * idle timeout below the 15s default can lower this via
 * `SSE_KEEPALIVE_INTERVAL_MS`.
 */
export function getSseKeepaliveIntervalMs(): number {
	const raw = Number(process.env.SSE_KEEPALIVE_INTERVAL_MS);
	if (Number.isFinite(raw) && raw > 0) {
		return raw;
	}
	return DEFAULT_SSE_KEEPALIVE_INTERVAL_MS;
}

interface KeepaliveWritable {
	write: (input: string) => Promise<unknown>;
}

/**
 * Starts an SSE keepalive on `stream`. Writes a comment line immediately — so
 * the response body's first byte (and any buffered headers) flushes at stream
 * open and the intermediary's read-idle timer starts counting from zero
 * instead of from the first upstream token — and then repeats every
 * `intervalMs`. Returns a function that stops the keepalive.
 *
 * The comment is a single-newline `: ping\n` (no trailing blank line) so buggy
 * SSE parsers (e.g. openai-python <=2.37.0, openai/openai-python#2722) don't
 * dispatch an empty-data event from a `\n\n` sequence once `last_event_id` is
 * set.
 */
export function startSseKeepalive(
	stream: KeepaliveWritable,
	intervalMs: number = getSseKeepaliveIntervalMs(),
): () => void {
	const ping = () => {
		void stream.write(": ping\n").catch(() => {
			// Stream likely closed; cleanup happens via the abort handler or the
			// finally block of the streaming handler.
		});
	};

	ping();
	const interval = setInterval(ping, intervalMs);

	return () => clearInterval(interval);
}
