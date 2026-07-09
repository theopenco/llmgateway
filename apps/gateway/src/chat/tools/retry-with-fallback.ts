import { hasInvalidProviderCredentialError } from "@/lib/provider-auth-errors.js";

import { DEFAULT_ROUTING_RETRY } from "@llmgateway/shared/routing-config";

export const MAX_RETRIES = DEFAULT_ROUTING_RETRY.maxRetries;

export type RetryableErrorType =
	| "network_error"
	| "provider_error"
	| "upstream_error"
	| "upstream_timeout"
	| "gateway_error";

export interface RoutingAttempt {
	provider: string;
	model: string;
	region?: string;
	status_code: number;
	error_type: string;
	succeeded: boolean;
	apiKeyHash?: string;
	logId?: string;
}

/**
 * @deprecated Use RoutingAttempt instead
 */
export type FailedAttempt = RoutingAttempt;

export function isRetryableErrorType(errorType: string): boolean {
	return (
		errorType === "network_error" ||
		errorType === "provider_error" ||
		errorType === "upstream_error" ||
		errorType === "upstream_timeout" ||
		errorType === "gateway_error"
	);
}

/**
 * Determines whether a failed request should be retried against another key
 * for the same provider.
 *
 * Auth failures (401/403) are not eligible for cross-provider fallback, but
 * they should still rotate to another configured key for the current provider
 * because the failure is often isolated to a single credential.
 */
export function shouldRetryAlternateKey(
	errorType: string,
	statusCode?: number,
	errorText?: string,
): boolean {
	return (
		isRetryableErrorType(errorType) ||
		(errorType === "gateway_error" &&
			((statusCode !== undefined &&
				(statusCode === 401 || statusCode === 403)) ||
				hasInvalidProviderCredentialError(errorText)))
	);
}

/**
 * Fixed delay before a same-key retry. Cross-provider fallback switches to a
 * different upstream and retries immediately, but a same-key retry re-hits
 * the upstream that just failed — a short pause gives transient faults a
 * moment to clear instead of immediately adding pressure. The added latency
 * is acceptable since the upstream is already slow or erroring.
 */
export const SAME_KEY_RETRY_DELAY_MS = 1000;

export function sameKeyRetryDelay(): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, SAME_KEY_RETRY_DELAY_MS);
	});
}

/**
 * Determines whether a failed request should be retried against the same
 * env-var key. This fires only when there is nowhere else to go: the model
 * resolves to a single provider (`hasOtherProvider` is false) and that
 * provider has a single env-var key (so the alternate-key path yields
 * nothing). It covers both direct-provider requests (`openai/gpt-4o`) and
 * auto-routed requests where only one provider is available — in both the
 * scored provider list contains just the one provider. When other providers
 * exist, cross-provider fallback handles retries instead and this stays off.
 *
 * Bounded by `maxRetries` (the resolved routing-config retry budget): with the
 * default of 2 this allows up to 2 same-key retries (3 attempts total); 0
 * disables same-key retries.
 *
 * Unlike cross-provider fallback — where a deterministic failure on one
 * provider (bad credentials, unknown model, out of funds) can legitimately
 * succeed on another — retrying the *same* key against the *same* provider
 * only helps for transient faults. Deterministic failures are excluded:
 * gateway_error (auth/config/payment) and all 4xx responses — the identical
 * request on the identical key will almost certainly fail the same way
 * (and re-firing a 429 would amplify rate-limit pressure). BYOK/custom
 * providers (envVarName unset) are also excluded.
 */
export function shouldRetrySameKey(opts: {
	usedProvider: string;
	errorType: string;
	statusCode?: number;
	envVarName: string | undefined;
	envKeyCount: number;
	hasOtherProvider: boolean;
	retryCount: number;
	maxRetries: number;
}): boolean {
	if (opts.retryCount >= opts.maxRetries) {
		return false;
	}
	if (opts.hasOtherProvider) {
		return false;
	}
	if (opts.usedProvider === "custom" || opts.usedProvider === "llmgateway") {
		return false;
	}
	if (!opts.envVarName) {
		return false;
	}
	if (opts.envKeyCount !== 1) {
		return false;
	}
	if (!isRetryableErrorType(opts.errorType)) {
		return false;
	}
	// Deterministic on the same key: auth/config/payment failures.
	if (opts.errorType === "gateway_error") {
		return false;
	}
	// Any 4xx is deterministic for the identical request on the identical
	// key — it will almost certainly fail the same way on a retry.
	if (
		opts.statusCode !== undefined &&
		opts.statusCode >= 400 &&
		opts.statusCode < 500
	) {
		return false;
	}
	return true;
}

/**
 * Determines whether a failed request should be retried with a different provider.
 * Only retries when no specific provider was requested, the error is retryable,
 * retry count hasn't been exceeded, and alternative providers are available.
 */
export function shouldRetryRequest(opts: {
	requestedProvider: string | undefined;
	noFallback: boolean;
	errorType: string;
	retryCount: number;
	remainingProviders: number;
	usedProvider: string;
	maxRetries?: number;
}): boolean {
	if (opts.requestedProvider) {
		return false;
	}
	if (opts.noFallback) {
		return false;
	}
	if (!isRetryableErrorType(opts.errorType)) {
		return false;
	}
	if (opts.retryCount >= (opts.maxRetries ?? MAX_RETRIES)) {
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
 * Returns the provider mapping with providerId and externalId, or null if none available.
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
		externalId: string;
		region?: string;
	}>,
): { providerId: string; externalId: string; region?: string } | null {
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
	if (statusCode === 401 || statusCode === 403) {
		return "gateway_error";
	}
	return "upstream_error";
}
