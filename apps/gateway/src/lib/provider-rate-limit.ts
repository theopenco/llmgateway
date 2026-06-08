import { randomUUID } from "node:crypto";

import { redisClient } from "@llmgateway/cache";
import { logger } from "@llmgateway/logger";

import { findEffectiveRateLimit } from "./cached-queries.js";

import type { RateLimitSource } from "@llmgateway/db";

export const providerRateLimitWindows = {
	rpm: {
		headerSuffix: "RPM",
		label: "requests per minute",
		redisSuffix: "rpm",
		seconds: 60,
	},
	rpd: {
		headerSuffix: "RPD",
		label: "requests per day",
		redisSuffix: "rpd",
		seconds: 60 * 60 * 24,
	},
} as const;

export type ProviderRateLimitWindow = keyof typeof providerRateLimitWindows;

export interface ProviderRateLimitWindowState {
	currentCount: number;
	limit: number;
	remaining: number;
	rateLimited: boolean;
	retryAfter?: number;
	source: RateLimitSource;
}

export interface ProviderRateLimitResult {
	allowed: boolean;
	rateLimited: boolean;
	blockedBy: ProviderRateLimitWindow[];
	retryAfter?: number;
	limits: Record<ProviderRateLimitWindow, ProviderRateLimitWindowState>;
}

// Sentinels for shared limits whose matched row left a dimension as a wildcard,
// so every matching request collapses onto one shared counter for that row.
const SHARED_ORG = "__global__";
const ALL_PROVIDERS = "__all_providers__";
const ALL_MODELS = "__all_models__";

function getProviderRateLimitKey(
	organizationId: string,
	provider: string,
	model: string,
	window: ProviderRateLimitWindow,
): string {
	return `rate_limit:provider_cap:${providerRateLimitWindows[window].redisSuffix}:${organizationId}:${provider}:${model}`;
}

/**
 * Build the Redis key for a window. Shared limits key by the matched row's
 * target (collapsing wildcard dimensions onto a sentinel) so a single counter
 * spans all orgs and all requests the row covers; per-org limits key by the
 * org and the concrete request provider/model.
 */
function buildProviderRateLimitKey(
	window: ProviderRateLimitWindow,
	organizationId: string,
	provider: string,
	model: string,
	shared: boolean | undefined,
	matchedProvider: string | null | undefined,
	matchedModel: string | null | undefined,
): string {
	if (!shared) {
		return getProviderRateLimitKey(organizationId, provider, model, window);
	}
	return getProviderRateLimitKey(
		SHARED_ORG,
		matchedProvider ?? ALL_PROVIDERS,
		matchedModel ?? ALL_MODELS,
		window,
	);
}

async function readWindowState(
	key: string,
	window: ProviderRateLimitWindow,
	limit: number,
	now: number,
	source: RateLimitSource,
): Promise<ProviderRateLimitWindowState> {
	if (limit === 0) {
		return {
			currentCount: 0,
			limit: 0,
			remaining: 0,
			rateLimited: false,
			source,
		};
	}

	const windowSeconds = providerRateLimitWindows[window].seconds;
	const windowDurationMs = windowSeconds * 1000;
	const windowStart = now - windowDurationMs;

	await redisClient.zremrangebyscore(key, "-inf", windowStart);
	const currentCount = await redisClient.zcard(key);

	if (currentCount >= limit) {
		const oldestEntry = await redisClient.zrange(key, 0, 0, "WITHSCORES");
		const retryAfter =
			oldestEntry.length > 1
				? Math.max(
						1,
						Math.ceil(
							(parseInt(oldestEntry[1], 10) + windowDurationMs - now) / 1000,
						),
					)
				: windowSeconds;

		return {
			currentCount,
			limit,
			remaining: 0,
			rateLimited: true,
			retryAfter,
			source,
		};
	}

	return {
		currentCount,
		limit,
		remaining: Math.max(0, limit - currentCount),
		rateLimited: false,
		source,
	};
}

async function addWindowEntry(
	key: string,
	window: ProviderRateLimitWindow,
	now: number,
	member: string,
): Promise<void> {
	await redisClient.zadd(key, now, member);
	await redisClient.expire(key, providerRateLimitWindows[window].seconds * 2);
}

function getCombinedRetryAfter(
	limits: Record<ProviderRateLimitWindow, ProviderRateLimitWindowState>,
	blockedBy: ProviderRateLimitWindow[],
): number | undefined {
	if (blockedBy.length === 0) {
		return undefined;
	}

	return blockedBy.reduce<number | undefined>((maxRetryAfter, window) => {
		const retryAfter = limits[window].retryAfter;
		if (retryAfter === undefined) {
			return maxRetryAfter;
		}
		return maxRetryAfter === undefined
			? retryAfter
			: Math.max(maxRetryAfter, retryAfter);
	}, undefined);
}

function buildFallbackResult(): ProviderRateLimitResult {
	return {
		allowed: true,
		rateLimited: false,
		blockedBy: [],
		limits: {
			rpm: {
				currentCount: 0,
				limit: 0,
				remaining: 0,
				rateLimited: false,
				source: "none",
			},
			rpd: {
				currentCount: 0,
				limit: 0,
				remaining: 0,
				rateLimited: false,
				source: "none",
			},
		},
	};
}

async function getProviderRateLimitStates(
	organizationId: string,
	provider: string,
	model: string,
): Promise<{
	keys: Record<ProviderRateLimitWindow, string>;
	limits: Record<ProviderRateLimitWindow, ProviderRateLimitWindowState>;
}> {
	const effectiveRateLimit = await findEffectiveRateLimit(
		organizationId,
		provider,
		model,
	);
	const now = Date.now();

	const keys = {
		rpm: buildProviderRateLimitKey(
			"rpm",
			organizationId,
			provider,
			model,
			effectiveRateLimit.rpmShared,
			effectiveRateLimit.rpmProvider,
			effectiveRateLimit.rpmModel,
		),
		rpd: buildProviderRateLimitKey(
			"rpd",
			organizationId,
			provider,
			model,
			effectiveRateLimit.rpdShared,
			effectiveRateLimit.rpdProvider,
			effectiveRateLimit.rpdModel,
		),
	};
	const limits = {
		rpm: await readWindowState(
			keys.rpm,
			"rpm",
			effectiveRateLimit.maxRpm,
			now,
			effectiveRateLimit.rpmSource,
		),
		rpd: await readWindowState(
			keys.rpd,
			"rpd",
			effectiveRateLimit.maxRpd,
			now,
			effectiveRateLimit.rpdSource,
		),
	};

	return { keys, limits };
}

export function getExceededProviderRateLimitLabels(
	blockedBy: ProviderRateLimitWindow[],
): string {
	return blockedBy
		.map((window) => providerRateLimitWindows[window].headerSuffix)
		.join(" and ");
}

/**
 * Read-only check of provider/model caps — does NOT consume a slot.
 * Used during routing to filter out rate-limited providers.
 */
export async function peekProviderRateLimit(
	organizationId: string,
	provider: string,
	model: string,
): Promise<ProviderRateLimitResult> {
	try {
		const { limits } = await getProviderRateLimitStates(
			organizationId,
			provider,
			model,
		);
		const blockedBy = (
			Object.entries(limits) as Array<
				[ProviderRateLimitWindow, ProviderRateLimitWindowState]
			>
		)
			.filter(([, limit]) => limit.rateLimited)
			.map(([window]) => window);

		return {
			allowed: blockedBy.length === 0,
			rateLimited: blockedBy.length > 0,
			blockedBy,
			retryAfter: getCombinedRetryAfter(limits, blockedBy),
			limits,
		};
	} catch (error) {
		logger.error("Error peeking provider rate limit:", error as Error);
		return buildFallbackResult();
	}
}

/**
 * Batch check which providers are rate-limited (read-only, no slot consumed).
 * Returns a Set of rate-limited provider IDs.
 */
export async function filterRateLimitedProviders(
	organizationId: string,
	candidates: Array<{
		providerId: string;
		model: string;
	}>,
): Promise<Set<string>> {
	const results = await Promise.all(
		candidates.map(async (candidate) => ({
			providerId: candidate.providerId,
			...(await peekProviderRateLimit(
				organizationId,
				candidate.providerId,
				candidate.model,
			)),
		})),
	);

	return new Set(
		results
			.filter((result) => result.rateLimited)
			.map((result) => result.providerId),
	);
}

/**
 * Pick fallback candidates that are not at their RPM/RPD cap.
 * Dedupes peeks by providerId since rate limits are keyed by org+provider+root
 * model id, so region-expanded variants share the same window. Falls open to
 * the original candidates if every one is capped, so callers always get a
 * non-empty list when input was non-empty.
 */
export async function pickNonRateLimitedCandidates<
	T extends { providerId: string },
>(organizationId: string, baseModelId: string, candidates: T[]): Promise<T[]> {
	if (candidates.length === 0) {
		return candidates;
	}

	const uniquePeekCandidates = Array.from(
		new Map(
			candidates.map((p) => [
				p.providerId,
				{
					providerId: p.providerId,
					model: baseModelId,
				},
			]),
		).values(),
	);

	const rateLimited = await filterRateLimitedProviders(
		organizationId,
		uniquePeekCandidates,
	);

	const nonRateLimited = candidates.filter(
		(p) => !rateLimited.has(p.providerId),
	);

	return nonRateLimited.length > 0 ? nonRateLimited : candidates;
}

/**
 * Check configurable provider/model caps stored in the database.
 * Uses a Redis sliding window approach identical to free model rate limiting.
 */
export async function checkProviderRateLimit(
	organizationId: string,
	provider: string,
	model: string,
): Promise<ProviderRateLimitResult> {
	try {
		const { keys, limits } = await getProviderRateLimitStates(
			organizationId,
			provider,
			model,
		);
		const blockedBy = (
			Object.entries(limits) as Array<
				[ProviderRateLimitWindow, ProviderRateLimitWindowState]
			>
		)
			.filter(([, limit]) => limit.rateLimited)
			.map(([window]) => window);

		if (blockedBy.length > 0) {
			const retryAfter = getCombinedRetryAfter(limits, blockedBy);

			logger.info(`Provider rate limit exceeded`, {
				organizationId,
				provider,
				model,
				blockedBy,
				limits,
				retryAfter,
			});

			return {
				allowed: false,
				rateLimited: true,
				blockedBy,
				retryAfter,
				limits,
			};
		}

		const now = Date.now();
		const member = `${now}:${randomUUID()}`;
		const configuredWindows = (
			Object.entries(limits) as Array<
				[ProviderRateLimitWindow, ProviderRateLimitWindowState]
			>
		).filter(([, limit]) => limit.limit > 0);

		await Promise.all(
			configuredWindows.map(([window]) =>
				addWindowEntry(keys[window], window, now, member),
			),
		);

		const updatedLimits = configuredWindows.reduce(
			(acc, [window, limit]) => {
				acc[window] = {
					...limit,
					currentCount: limit.currentCount + 1,
					remaining: Math.max(0, limit.limit - limit.currentCount - 1),
				};
				return acc;
			},
			{
				rpm: limits.rpm,
				rpd: limits.rpd,
			},
		);

		logger.debug(`Provider rate limit check passed`, {
			organizationId,
			provider,
			model,
			limits: updatedLimits,
		});

		return {
			allowed: true,
			rateLimited: false,
			blockedBy: [],
			limits: updatedLimits,
		};
	} catch (error) {
		logger.error("Error checking provider rate limit:", error as Error);
		return buildFallbackResult();
	}
}
