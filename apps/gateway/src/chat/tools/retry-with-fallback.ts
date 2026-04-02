export const MAX_RETRIES = 2;

export interface RoutingAttempt {
	provider: string;
	model: string;
	region?: string;
	status_code: number;
	error_type: string;
	succeeded: boolean;
}

/**
 * @deprecated Use RoutingAttempt instead
 */
export type FailedAttempt = RoutingAttempt;

/**
 * Checks if an HTTP status code (or 0 for network errors) is retryable.
 * Retryable: 5xx server errors, 429 rate limits, 0 (network failures/timeouts).
 * NOT retryable: 404 (model not found), 400 (client error), 401/403 (auth).
 */
export function isRetryableError(statusCode: number): boolean {
	return statusCode === 429 || statusCode >= 500 || statusCode === 0;
}

/**
 * Determines whether a failed request should be retried with a different provider.
 * Only retries when no specific provider was requested, the error is retryable,
 * retry count hasn't been exceeded, and alternative providers are available.
 */
export function shouldRetryRequest(opts: {
	requestedProvider: string | undefined;
	noFallback: boolean;
	statusCode: number;
	retryCount: number;
	remainingProviders: number;
	usedProvider: string;
}): boolean {
	if (opts.requestedProvider) {
		return false;
	}
	if (opts.noFallback) {
		return false;
	}
	if (!isRetryableError(opts.statusCode)) {
		return false;
	}
	if (opts.retryCount >= MAX_RETRIES) {
		return false;
	}
	if (opts.remainingProviders <= 0) {
		return false;
	}
	if (opts.usedProvider === "custom" || opts.usedProvider === "llmgateway") {
		return false;
	}
	return true;
}

/**
 * Build a composite key for identifying a provider+region combination.
 * Used by the retry system to track which provider-region pairs have been tried.
 */
export function providerRetryKey(providerId: string, region?: string): string {
	return region ? `${providerId}:${region}` : providerId;
}

/**
 * Selects the next-best provider from the scored provider list,
 * excluding any providers that have already been tried and failed.
 * Returns the provider mapping with providerId and modelName, or null if none available.
 * When region is present on scores, uses composite providerId:region keys for deduplication.
 */
export function selectNextProvider(
	providerScores: Array<{
		providerId: string;
		score: number;
		region?: string;
		excludedByContentFilter?: boolean;
	}>,
	failedProviders: Set<string>,
	modelProviders: Array<{
		providerId: string;
		modelName: string;
		region?: string;
	}>,
): { providerId: string; modelName: string; region?: string } | null {
	const sorted = [...providerScores].sort((a, b) => a.score - b.score);
	for (const score of sorted) {
		if (score.excludedByContentFilter) {
			continue;
		}

		const key = providerRetryKey(score.providerId, score.region);
		if (failedProviders.has(key)) {
			continue;
		}
		const mapping = modelProviders.find(
			(p) => p.providerId === score.providerId && p.region === score.region,
		);
		if (mapping) {
			return mapping;
		}
	}
	return null;
}

/**
 * Maps an HTTP status code to a human-readable error type for the routing metadata.
 */
export function getErrorType(statusCode: number): string {
	if (statusCode === 0) {
		return "network_error";
	}
	if (statusCode === 429) {
		return "rate_limited";
	}
	return "upstream_error";
}
