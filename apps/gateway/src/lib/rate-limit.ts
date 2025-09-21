import { redisClient } from "@llmgateway/cache";
import { cdb as db } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";

import type { ModelDefinition } from "@llmgateway/models";

/**
 * Rate limiting configuration for free models
 */
const FREE_MODEL_RATE_LIMITS = {
	// 5 request per 10 minutes for orgs with 0 credits
	BASE_LIMIT: 5,
	BASE_WINDOW: 600, // 10 minutes in seconds

	// 20 requests per minute for orgs with > 0 credits
	ELEVATED_LIMIT: 20,
	ELEVATED_WINDOW: 60, // seconds
};

/**
 * Check if a model is free based on model definition
 */
export function isFreeModel(
	modelDefinition: Partial<ModelDefinition> | null | undefined,
): boolean {
	return modelDefinition?.free === true;
}

/**
 * Generate Redis key for rate limiting
 */
function getRateLimitKey(organizationId: string, model: string): string {
	return `rate_limit:free_model:${organizationId}:${model}`;
}

/**
 * Check if organization has elevated rate limits (credits > 0)
 */
async function hasElevatedLimits(organizationId: string): Promise<boolean> {
	try {
		const org = await db.query.organization.findFirst({
			where: {
				id: {
					eq: organizationId,
				},
			},
		});
		return Boolean(org && parseFloat(org.credits || "0") > 0);
	} catch (error) {
		logger.error(
			"Error checking organization credits for rate limiting:",
			error as Error,
		);
		// Default to base limits on error
		return false;
	}
}

/**
 * Check rate limit for free models
 * Returns true if request is allowed, false if rate limited
 */
export async function checkFreeModelRateLimit(
	organizationId: string,
	model: string,
	modelDefinition: Partial<ModelDefinition> | null | undefined,
): Promise<{
	allowed: boolean;
	retryAfter?: number;
	remaining: number;
	limit: number;
}> {
	// Only apply rate limiting to free models
	if (!isFreeModel(modelDefinition)) {
		return { allowed: true, remaining: 0, limit: 0 };
	}

	try {
		const hasElevated = await hasElevatedLimits(organizationId);
		const limit = hasElevated
			? FREE_MODEL_RATE_LIMITS.ELEVATED_LIMIT
			: FREE_MODEL_RATE_LIMITS.BASE_LIMIT;
		const window = hasElevated
			? FREE_MODEL_RATE_LIMITS.ELEVATED_WINDOW
			: FREE_MODEL_RATE_LIMITS.BASE_WINDOW;

		const key = getRateLimitKey(organizationId, model);

		// Use sliding window approach with Redis
		const now = Date.now();
		const windowStart = now - window * 1000;

		// Remove old entries and count current requests in window
		await redisClient.zremrangebyscore(key, "-inf", windowStart);
		const currentCount = await redisClient.zcard(key);

		if (currentCount >= limit) {
			// Rate limited - calculate retry after
			const oldestEntry = await redisClient.zrange(key, 0, 0, "WITHSCORES");
			const retryAfter =
				oldestEntry.length > 1
					? Math.ceil(
							(parseInt(oldestEntry[1], 10) + window * 1000 - now) / 1000,
						)
					: window;

			logger.info(`Rate limit exceeded for free model`, {
				organizationId,
				model,
				currentCount,
				limit,
				hasElevated,
				retryAfter,
			});

			return { allowed: false, retryAfter, remaining: 0, limit };
		}

		// Add current request to sliding window
		await redisClient.zadd(key, now, now.toString());
		await redisClient.expire(key, window * 2); // Set expiry to 2x window for cleanup

		logger.debug(`Free model rate limit check passed`, {
			organizationId,
			model,
			currentCount: currentCount + 1,
			limit,
			hasElevated,
		});

		return {
			allowed: true,
			remaining: Math.max(0, limit - currentCount - 1),
			limit,
		};
	} catch (error) {
		logger.error("Error checking free model rate limit:", error as Error);
		// Allow request on error to avoid blocking users due to Redis issues
		return { allowed: true, remaining: 0, limit: 0 };
	}
}
