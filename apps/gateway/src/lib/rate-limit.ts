import { randomUUID } from "node:crypto";

import { findOrganizationById } from "@/lib/cached-queries.js";

import { logger } from "@llmgateway/logger";

import { checkAndAddSlidingWindow } from "./rate-limit-windows.js";

import type { ModelDefinition } from "@llmgateway/models";

/**
 * Rate limiting configuration for free models
 */
const FREE_MODEL_RATE_LIMITS = {
	LOW: {
		// 5 request per 10 minutes for orgs with 0 credits
		BASE_LIMIT: 5,
		BASE_WINDOW: 600, // 10 minutes in seconds

		// 20 requests per minute for orgs with > 0 credits
		ELEVATED_LIMIT: 20,
		ELEVATED_WINDOW: 60, // seconds
	},
	HIGH: {
		// More generous limits for high-tier free models
		// 50 requests per 10 minutes for orgs with 0 credits
		BASE_LIMIT: 50,
		BASE_WINDOW: 600, // 10 minutes in seconds

		// 100 requests per minute for orgs with > 0 credits
		ELEVATED_LIMIT: 100,
		ELEVATED_WINDOW: 60, // seconds
	},
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
		const org = await findOrganizationById(organizationId);
		return Boolean(org && parseFloat(org.credits ?? "0") > 0);
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
		const rateLimitKind = modelDefinition?.rateLimitKind ?? "low";
		const limits =
			FREE_MODEL_RATE_LIMITS[rateLimitKind.toUpperCase() as "LOW" | "HIGH"];

		const limit = hasElevated ? limits.ELEVATED_LIMIT : limits.BASE_LIMIT;
		const window = hasElevated ? limits.ELEVATED_WINDOW : limits.BASE_WINDOW;

		const key = getRateLimitKey(organizationId, model);

		const now = Date.now();
		// Unique member: `now` alone collides under same-millisecond concurrency.
		const member = `${now}:${randomUUID()}`;
		const { allowed, currentCount, retryAfter } =
			await checkAndAddSlidingWindow(key, window, limit, now, member);

		if (!allowed) {
			logger.info(`Rate limit exceeded for free model`, {
				organizationId,
				model,
				currentCount,
				limit,
				hasElevated,
				rateLimitKind: modelDefinition?.rateLimitKind ?? "low",
				retryAfter,
			});

			return { allowed: false, retryAfter, remaining: 0, limit };
		}

		logger.debug(`Free model rate limit check passed`, {
			organizationId,
			model,
			currentCount: currentCount + 1,
			limit,
			hasElevated,
			rateLimitKind: modelDefinition?.rateLimitKind ?? "low",
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
