/**
 * Retry configuration and utilities for the gateway.
 *
 * Provides automatic retry logic with exponential backoff for upstream provider requests.
 * Default: 3 retries with 1s, 2s, 4s delays (configurable via environment variables).
 */

import { logger } from "@llmgateway/logger";

/**
 * Gets the maximum number of retry attempts.
 * Default: 3 attempts
 */
export function getMaxRetryAttempts(): number {
	const envValue = Number(process.env.RETRY_MAX_ATTEMPTS);
	if (envValue >= 0) {
		return envValue;
	}
	return 3;
}

/**
 * Gets the initial backoff delay in milliseconds.
 * Default: 1000ms (1 second)
 */
export function getRetryInitialBackoffMs(): number {
	const envValue = Number(process.env.RETRY_INITIAL_BACKOFF_MS);
	if (envValue > 0) {
		return envValue;
	}
	return 1000;
}

/**
 * Gets the backoff multiplier for exponential backoff.
 * Default: 2.0 (delays: 1s, 2s, 4s, 8s, ...)
 */
export function getRetryBackoffMultiplier(): number {
	const envValue = Number(process.env.RETRY_BACKOFF_MULTIPLIER);
	if (envValue > 0) {
		return envValue;
	}
	return 2.0;
}

/**
 * Calculates the delay for a given retry attempt using exponential backoff.
 * Attempt 0 = initial delay, Attempt 1 = initial * multiplier, etc.
 *
 * @param attempt - The retry attempt number (0-indexed)
 * @returns Delay in milliseconds
 */
export function calculateBackoffDelay(attempt: number): number {
	const initialDelay = getRetryInitialBackoffMs();
	const multiplier = getRetryBackoffMultiplier();
	return initialDelay * Math.pow(multiplier, attempt);
}

/**
 * HTTP status codes that should trigger a retry.
 * - 408: Request Timeout
 * - 429: Too Many Requests (rate limit)
 * - 500: Internal Server Error
 * - 502: Bad Gateway
 * - 503: Service Unavailable
 * - 504: Gateway Timeout
 */
const DEFAULT_RETRYABLE_STATUS_CODES = [408, 429, 500, 502, 503, 504];

/**
 * Gets the list of HTTP status codes that should trigger a retry.
 */
export function getRetryableStatusCodes(): number[] {
	const envValue = process.env.RETRY_STATUS_CODES;
	if (envValue) {
		const codes = envValue
			.split(",")
			.map((s) => parseInt(s.trim(), 10))
			.filter((n) => !isNaN(n));
		if (codes.length > 0) {
			return codes;
		}
	}
	return DEFAULT_RETRYABLE_STATUS_CODES;
}

/**
 * Checks if an HTTP status code is retryable.
 */
export function isRetryableStatusCode(statusCode: number): boolean {
	return getRetryableStatusCodes().includes(statusCode);
}

/**
 * Checks if an error is retryable (network errors, timeouts).
 */
export function isRetryableError(error: unknown): boolean {
	if (error instanceof Error) {
		// Timeout errors are retryable
		if (error.name === "TimeoutError") {
			return true;
		}
		// Network errors (connection refused, DNS failures, etc.)
		if (
			error.message.includes("ECONNREFUSED") ||
			error.message.includes("ECONNRESET") ||
			error.message.includes("ETIMEDOUT") ||
			error.message.includes("ENOTFOUND") ||
			error.message.includes("fetch failed")
		) {
			return true;
		}
	}
	return false;
}

/**
 * Checks if a cancellation error occurred (user-initiated abort).
 * These should NOT be retried.
 */
export function isCancellationError(error: unknown): boolean {
	if (error instanceof Error) {
		return error.name === "AbortError";
	}
	return false;
}

/**
 * Sleep for the specified duration.
 */
function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

/**
 * Result of a fetch operation with retry context.
 */
export type FetchWithRetryResult =
	| { success: true; response: Response; attempts: number }
	| {
			success: false;
			error: Error;
			attempts: number;
			canceled: boolean;
			lastResponse?: Response;
	  };

/**
 * Options for fetchWithRetry.
 */
export interface FetchWithRetryOptions {
	url: string;
	init: RequestInit;
	/** Maximum time budget for all retries in milliseconds. If not set, no time budget is enforced. */
	timeBudgetMs?: number;
	/** Request ID for logging purposes */
	requestId?: string;
	/** Provider name for logging purposes */
	provider?: string;
	/** Model name for logging purposes */
	model?: string;
	/**
	 * Override the maximum number of retry attempts.
	 * - undefined: use default from env/config (default: 3)
	 * - null: disable retries (same as 0)
	 * - 0: disable retries
	 * - positive number: use that many retries
	 */
	maxRetries?: number | null;
}

/**
 * Performs a fetch request with automatic retry on retryable errors.
 *
 * Retries are performed with exponential backoff:
 * - Attempt 1: immediate
 * - Attempt 2: after 1s delay (configurable)
 * - Attempt 3: after 2s delay
 * - Attempt 4: after 4s delay
 * - etc.
 *
 * Retries happen on:
 * - Network errors (connection refused, DNS failures, etc.)
 * - Timeout errors
 * - Retryable HTTP status codes (408, 429, 500, 502, 503, 504)
 *
 * Retries do NOT happen on:
 * - User cancellation (AbortError)
 * - Non-retryable HTTP status codes (4xx except 408, 429)
 */
export async function fetchWithRetry(
	options: FetchWithRetryOptions,
): Promise<FetchWithRetryResult> {
	const { url, init, timeBudgetMs, requestId, provider, model, maxRetries } =
		options;

	// Determine max retries: explicit null or 0 means no retries, undefined uses default
	let retryCount: number;
	if (maxRetries === null || maxRetries === 0) {
		retryCount = 0;
	} else if (maxRetries !== undefined) {
		retryCount = maxRetries;
	} else {
		retryCount = getMaxRetryAttempts();
	}

	const maxAttempts = retryCount + 1; // +1 because first attempt is not a retry
	const startTime = Date.now();

	let lastError: Error | null = null;
	let lastResponse: Response | undefined;
	let attempt = 0;

	for (attempt = 0; attempt < maxAttempts; attempt++) {
		// Check time budget before attempting
		if (timeBudgetMs !== undefined) {
			const elapsed = Date.now() - startTime;
			if (elapsed >= timeBudgetMs) {
				logger.debug("Retry time budget exceeded", {
					requestId,
					attempt,
					elapsed,
					timeBudgetMs,
				});
				break;
			}
		}

		// Apply backoff delay before retry (not before first attempt)
		if (attempt > 0) {
			const delay = calculateBackoffDelay(attempt - 1);

			// Check if delay would exceed time budget
			if (timeBudgetMs !== undefined) {
				const elapsed = Date.now() - startTime;
				if (elapsed + delay >= timeBudgetMs) {
					logger.debug("Retry delay would exceed time budget", {
						requestId,
						attempt,
						delay,
						elapsed,
						timeBudgetMs,
					});
					break;
				}
			}

			logger.info("Retrying request", {
				requestId,
				attempt,
				maxAttempts,
				delay,
				provider,
				model,
				lastError: lastError?.message,
				lastStatus: lastResponse?.status,
			});

			await sleep(delay);
		}

		try {
			const response = await fetch(url, init);

			// Check if response status is retryable
			if (!response.ok && isRetryableStatusCode(response.status)) {
				lastResponse = response;
				lastError = new Error(
					`HTTP ${response.status}: ${response.statusText}`,
				);

				// Don't retry if this was the last attempt
				if (attempt < maxAttempts - 1) {
					logger.debug("Retryable HTTP status received", {
						requestId,
						attempt,
						status: response.status,
						provider,
						model,
					});
					continue;
				}
			}

			// Success or non-retryable status
			return {
				success: true,
				response,
				attempts: attempt + 1,
			};
		} catch (error) {
			// Check for cancellation - don't retry
			if (isCancellationError(error)) {
				return {
					success: false,
					error: error instanceof Error ? error : new Error(String(error)),
					attempts: attempt + 1,
					canceled: true,
					lastResponse,
				};
			}

			lastError = error instanceof Error ? error : new Error(String(error));

			// Check if error is retryable
			if (!isRetryableError(error)) {
				return {
					success: false,
					error: lastError,
					attempts: attempt + 1,
					canceled: false,
					lastResponse,
				};
			}

			// Log retry attempt
			if (attempt < maxAttempts - 1) {
				logger.debug("Retryable error occurred", {
					requestId,
					attempt,
					error: lastError.message,
					errorName: lastError.name,
					provider,
					model,
				});
			}
		}
	}

	// All retries exhausted
	return {
		success: false,
		error: lastError || new Error("Max retries exceeded"),
		attempts: attempt,
		canceled: false,
		lastResponse,
	};
}
