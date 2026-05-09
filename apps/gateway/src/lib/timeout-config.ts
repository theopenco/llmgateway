/**
 * Timeout configuration for the gateway.
 *
 * The AI request timeout should be shorter than the gateway timeout to ensure
 * we can catch and handle upstream timeouts before the overall request times out.
 *
 * All timeout values are read dynamically at call time to support testing.
 */

/**
 * Gets the gateway request timeout - the maximum time a request can take end-to-end.
 * Default: 5 minutes (300000ms)
 */
export function getGatewayTimeoutMs(): number {
	return Number(process.env.GATEWAY_TIMEOUT_MS) || 300000;
}

/**
 * Gets the AI API request timeout for streaming requests - the maximum time for upstream provider calls.
 * Should be shorter than gateway timeout to allow for error handling.
 * Default: 4 minutes (240000ms) or 80% of gateway timeout, whichever is smaller
 */
export function getStreamingTimeoutMs(): number {
	const envValue = Number(process.env.AI_STREAMING_TIMEOUT_MS);
	if (envValue > 0) {
		return envValue;
	}
	// Default: 4 minutes or 80% of gateway timeout, whichever is smaller
	return Math.min(240000, getGatewayTimeoutMs() * 0.8);
}

/**
 * Gets the AI API request timeout for non-streaming (plain) requests.
 * Non-streaming requests have a shorter default timeout since they don't benefit
 * from incremental responses and long waits are usually indicative of issues.
 * Default: 3 minutes (180000ms)
 */
export function getTimeoutMs(): number {
	const envValue = Number(process.env.AI_TIMEOUT_MS);
	if (envValue > 0) {
		return envValue;
	}
	// Default: 3 minutes for non-streaming requests
	return 180000;
}

/**
 * Gets the upstream stall threshold for streaming requests BEFORE the first
 * token (or reasoning token) has been received. If the upstream provider goes
 * silent for longer than this, we treat it as an upstream error rather than
 * waiting for the full streaming timeout (or, worse, attributing it to a
 * client-initiated cancellation when the client gives up first).
 *
 * Slow-start reasoning models can legitimately stay quiet for a while before
 * emitting their first token, so the pre-TTFT window is more generous than
 * the post-TTFT window.
 *
 * Set to 0 (or a negative value) to disable pre-TTFT stall detection.
 * Default: 60 seconds (60000ms)
 */
export function getUpstreamPreTtftStallMs(): number {
	const raw = process.env.UPSTREAM_PRE_TTFT_STALL_MS;
	if (raw === undefined || raw === "") {
		return 60000;
	}
	const parsed = Number(raw);
	if (!Number.isFinite(parsed)) {
		return 60000;
	}
	return parsed;
}

/**
 * Gets the upstream stall threshold for streaming requests AFTER the first
 * token has been received. Once the upstream is actively streaming, a long
 * silence is almost always an upstream issue (provider crash, dropped
 * connection, infrastructure outage), so this threshold is shorter than the
 * pre-TTFT one.
 *
 * Set to 0 (or a negative value) to disable post-TTFT stall detection.
 * Default: 30 seconds (30000ms)
 */
export function getUpstreamPostTtftStallMs(): number {
	const raw = process.env.UPSTREAM_POST_TTFT_STALL_MS;
	if (raw === undefined || raw === "") {
		return 30000;
	}
	const parsed = Number(raw);
	if (!Number.isFinite(parsed)) {
		return 30000;
	}
	return parsed;
}

// Legacy exports for backwards compatibility (read at module load time)
// These should be avoided in new code - use the getter functions instead
export const GATEWAY_TIMEOUT_MS = getGatewayTimeoutMs();
export const AI_STREAMING_TIMEOUT_MS = getStreamingTimeoutMs();
export const AI_TIMEOUT_MS = getTimeoutMs();

/**
 * Creates an AbortSignal that will abort after the streaming request timeout.
 * Can be combined with other signals (e.g., client cancellation) using AbortSignal.any().
 */
export function createStreamingTimeoutSignal(): AbortSignal {
	return AbortSignal.timeout(getStreamingTimeoutMs());
}

/**
 * Creates an AbortSignal that will abort after the plain (non-streaming) request timeout.
 * Can be combined with other signals (e.g., client cancellation) using AbortSignal.any().
 */
export function createTimeoutSignal(): AbortSignal {
	return AbortSignal.timeout(getTimeoutMs());
}

/**
 * Combines a streaming timeout signal with an optional cancellation signal.
 * If the cancellation signal is provided, the request will abort on either timeout or cancellation.
 * If no cancellation signal is provided, only the timeout will cause an abort.
 */
export function createStreamingCombinedSignal(
	cancellationController?: AbortController,
): AbortSignal {
	const timeoutSignal = createStreamingTimeoutSignal();

	if (cancellationController) {
		return AbortSignal.any([timeoutSignal, cancellationController.signal]);
	}

	return timeoutSignal;
}

/**
 * Combines a plain (non-streaming) timeout signal with an optional cancellation signal.
 * Uses the shorter timeout (default 3min) for non-streaming requests.
 */
export function createCombinedSignal(
	cancellationController?: AbortController,
): AbortSignal {
	const timeoutSignal = createTimeoutSignal();

	if (cancellationController) {
		return AbortSignal.any([timeoutSignal, cancellationController.signal]);
	}

	return timeoutSignal;
}

/**
 * Checks if an error is a timeout error.
 * AbortSignal.timeout() throws a DOMException with name "TimeoutError".
 */
export function isTimeoutError(error: unknown): boolean {
	if (error instanceof Error) {
		// AbortSignal.timeout() throws a DOMException with name "TimeoutError"
		return error.name === "TimeoutError";
	}
	return false;
}

/**
 * Checks if an error is a cancellation error (user-initiated abort).
 * AbortController.abort() throws a DOMException with name "AbortError".
 */
export function isCancellationError(error: unknown): boolean {
	if (error instanceof Error) {
		return error.name === "AbortError";
	}
	return false;
}
