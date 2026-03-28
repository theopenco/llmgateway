import { randomUUID } from "node:crypto";

import { redisClient } from "@llmgateway/cache";
import { getEffectiveRateLimit } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";

const WINDOW_SECONDS = 60; // 1 minute for RPM

/**
 * Generate Redis key for provider/model rate limiting
 */
function getProviderRateLimitKey(
	organizationId: string,
	provider: string,
	model: string,
): string {
	return `rate_limit:provider_cap:${organizationId}:${provider}:${model}`;
}

/**
 * Check configurable provider/model RPM caps stored in the database.
 * Uses a Redis sliding window approach identical to free model rate limiting.
 */
/**
 * Read-only check of provider/model RPM caps — does NOT consume a slot.
 * Used during routing to filter out rate-limited providers.
 */
export async function peekProviderRateLimit(
	organizationId: string,
	provider: string,
	model: string,
	providerModelName?: string,
): Promise<{ rateLimited: boolean; limit: number; currentCount: number }> {
	try {
		const result = await getEffectiveRateLimit(
			organizationId,
			provider,
			model,
			providerModelName,
		);

		if (result.maxRpm === 0) {
			return { rateLimited: false, limit: 0, currentCount: 0 };
		}

		const limit = result.maxRpm;
		const key = getProviderRateLimitKey(organizationId, provider, model);

		const now = Date.now();
		// eslint-disable-next-line no-mixed-operators
		const windowStart = now - WINDOW_SECONDS * 1000;

		await redisClient.zremrangebyscore(key, "-inf", windowStart);
		const currentCount = await redisClient.zcard(key);

		return { rateLimited: currentCount >= limit, limit, currentCount };
	} catch (error) {
		logger.error("Error peeking provider rate limit:", error as Error);
		return { rateLimited: false, limit: 0, currentCount: 0 };
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
		providerModelName?: string;
	}>,
): Promise<Set<string>> {
	const results = await Promise.all(
		candidates.map(async (c) => ({
			providerId: c.providerId,
			...(await peekProviderRateLimit(
				organizationId,
				c.providerId,
				c.model,
				c.providerModelName,
			)),
		})),
	);
	return new Set(results.filter((r) => r.rateLimited).map((r) => r.providerId));
}

/**
 * Check configurable provider/model RPM caps stored in the database.
 * Uses a Redis sliding window approach identical to free model rate limiting.
 */
export async function checkProviderRateLimit(
	organizationId: string,
	provider: string,
	model: string,
	providerModelName?: string,
): Promise<{
	allowed: boolean;
	retryAfter?: number;
	remaining: number;
	limit: number;
}> {
	try {
		const result = await getEffectiveRateLimit(
			organizationId,
			provider,
			model,
			providerModelName,
		);

		// No rate limit configured — allow the request
		if (result.maxRpm === 0) {
			return { allowed: true, remaining: 0, limit: 0 };
		}

		const limit = result.maxRpm;
		const key = getProviderRateLimitKey(organizationId, provider, model);

		// Sliding window approach with Redis sorted sets
		const now = Date.now();
		// eslint-disable-next-line no-mixed-operators
		const windowStart = now - WINDOW_SECONDS * 1000;

		// Remove old entries and count current requests in window
		await redisClient.zremrangebyscore(key, "-inf", windowStart);
		const currentCount = await redisClient.zcard(key);

		if (currentCount >= limit) {
			// Rate limited — calculate retry after
			const oldestEntry = await redisClient.zrange(key, 0, 0, "WITHSCORES");
			const retryAfter =
				oldestEntry.length > 1
					? Math.ceil(
							(parseInt(oldestEntry[1], 10) + WINDOW_SECONDS * 1000 - now) /
								1000,
						)
					: WINDOW_SECONDS;

			logger.info(`Provider rate limit exceeded`, {
				organizationId,
				provider,
				model,
				providerModelName,
				currentCount,
				limit,
				source: result.source,
				retryAfter,
			});

			return { allowed: false, retryAfter, remaining: 0, limit };
		}

		// Add current request to sliding window with a unique member
		const member = `${now}:${randomUUID()}`;
		await redisClient.zadd(key, now, member);
		await redisClient.expire(key, WINDOW_SECONDS * 2); // 2x window for cleanup

		logger.debug(`Provider rate limit check passed`, {
			organizationId,
			provider,
			model,
			providerModelName,
			currentCount: currentCount + 1,
			limit,
			source: result.source,
		});

		return {
			allowed: true,
			remaining: Math.max(0, limit - currentCount - 1),
			limit,
		};
	} catch (error) {
		logger.error("Error checking provider rate limit:", error as Error);
		// Fail-open: allow request on error to avoid blocking users due to Redis issues
		return { allowed: true, remaining: 0, limit: 0 };
	}
}
