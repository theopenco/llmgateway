import { randomUUID } from "node:crypto";

import { redisClient } from "@llmgateway/cache";
import {
	db,
	eq,
	sql,
	project as projectTable,
	projectHourlyStats,
} from "@llmgateway/db";
import { logger } from "@llmgateway/logger";
import {
	baseLimitEnvVar,
	getBaseLimit,
	getOrgSpendTier,
	getPlanClass,
	getRateLimitEnvNumber,
	PATH_RATE_LIMITS,
	resolvePathRateLimit,
	type PathRateLimitConfig,
	type PlanClass,
	type ResolvedSpendTier,
} from "@llmgateway/shared";

import { findApiKeyByToken, findProjectById } from "./cached-queries.js";

/**
 * Per-organization, per-path rate limiting for the gateway.
 *
 * The pure ladder/config (`PATH_RATE_LIMITS`, plan classes, the spend-tier
 * ladder, and `getOrgSpendTier`) lives in `@llmgateway/shared` so the API can
 * display the same limits in the dashboard. This module keeps the gateway-only
 * side effects: the sliding-window Redis counter and the cached lifetime-spend
 * aggregation used to resolve an org's tier on the hot path.
 */

// Re-export the shared pure helpers so existing gateway/middleware/test imports
// keep resolving from this module.
export {
	baseLimitEnvVar,
	getBaseLimit,
	getOrgSpendTier,
	getPlanClass,
	PATH_RATE_LIMITS,
	resolvePathRateLimit,
};
export type { PathRateLimitConfig, PlanClass, ResolvedSpendTier };

/**
 * Whether org rate limiting is enforced. `GATEWAY_RATE_LIMITS_ENABLED` is the
 * global switch: set it to "false" to turn off all gateway rate limiting (e.g.
 * to debug in prod without a redeploy) or "true" to force it on. When unset it
 * defaults to enabled in every environment except the e2e suite (which fires
 * many requests against a single org and would otherwise be throttled).
 */
export function isOrgRateLimitEnabled(): boolean {
	const explicit = process.env.GATEWAY_RATE_LIMITS_ENABLED;
	if (explicit !== undefined) {
		return explicit === "true";
	}
	return process.env.E2E_TEST !== "true";
}

/** The sliding window size in seconds (shared across paths). */
function getWindowSeconds(): number {
	return getRateLimitEnvNumber("GATEWAY_RATE_LIMIT_WINDOW_SECONDS", 60);
}

/**
 * Resolve the organization id for an API token via the cached
 * token -> api key -> project -> organization chain. Returns `null` when the
 * token cannot be resolved (the downstream handler will reject it).
 */
export async function resolveOrganizationIdForToken(
	token: string,
): Promise<string | null> {
	const apiKey = await findApiKeyByToken(token);
	if (!apiKey) {
		return null;
	}
	const project = await findProjectById(apiKey.projectId);
	if (!project) {
		return null;
	}
	return project.organizationId;
}

function spendCacheKey(organizationId: string): string {
	return `rate_limit:org_spend:${organizationId}`;
}

/**
 * Lifetime spend (USD) for an organization, aggregated from hourly project
 * stats and cached in Redis.
 *
 * This deliberately does NOT use the `cached-queries` (swrWrap + cdb) pattern.
 * Those caches auto-invalidate whenever their backing table is written, and
 * `project_hourly_stats` is rewritten continuously by the worker — so a
 * swr/cdb cache for this aggregate would be evicted constantly and hammer
 * Postgres at gateway throughput. Instead we use a plain fixed-TTL Redis entry:
 * the spend tier is coarse and does not need to reflect a write instantly. The
 * lookup is also only reached lazily, once an org is already at its base limit
 * (see {@link checkOrgRateLimit}), so the hot path never touches Postgres.
 */
export async function getOrganizationLifetimeSpend(
	organizationId: string,
): Promise<number> {
	const cacheKey = spendCacheKey(organizationId);

	try {
		const cached = await redisClient.get(cacheKey);
		if (cached !== null) {
			const value = Number(cached);
			if (Number.isFinite(value)) {
				return value;
			}
		}

		const rows = await db
			.select({
				total: sql<string>`COALESCE(SUM(CAST(${projectHourlyStats.cost} AS NUMERIC)), 0)`,
			})
			.from(projectHourlyStats)
			.innerJoin(
				projectTable,
				eq(projectHourlyStats.projectId, projectTable.id),
			)
			.where(eq(projectTable.organizationId, organizationId));

		const total = Number(rows[0]?.total ?? "0");
		const value = Number.isFinite(total) ? total : 0;

		const ttl = getRateLimitEnvNumber(
			"GATEWAY_RATE_LIMIT_SPEND_CACHE_SECONDS",
			900,
		);
		await redisClient.set(cacheKey, String(value), "EX", Math.max(1, ttl));

		return value;
	} catch (error) {
		// Never let a spend-lookup failure break a request: fall back to the
		// base tier (multiplier 1), which still applies the generous default
		// per-path limit.
		logger.error(
			"Error resolving organization lifetime spend for rate limiting:",
			error as Error,
		);
		return 0;
	}
}

export interface RateLimitResult {
	allowed: boolean;
	retryAfter?: number;
	remaining: number;
	limit: number;
}

/**
 * Check (and record) a request against an organization's per-path rate limit
 * using a Redis sliding window. Mirrors the free-model limiter: on any Redis
 * error the request is allowed so that limiter outages never block traffic.
 *
 * The base limit depends on the org's `planClass` (dev/chat plans are much
 * tighter). `getMultiplier` is resolved lazily: the spend tier only matters
 * once the org is already at or above its base limit, so the (cached but still
 * extra) spend lookup is skipped entirely for the common under-limit case.
 * Higher tiers can only raise the limit, so a request under the base limit is
 * always allowed regardless of tier.
 */
export async function checkOrgRateLimit(
	organizationId: string,
	config: PathRateLimitConfig,
	planClass: PlanClass,
	getMultiplier: () => Promise<number>,
): Promise<RateLimitResult> {
	const baseLimit = getBaseLimit(config, planClass);

	// A non-positive base limit means the path is effectively unlimited (e.g. an
	// operator set the override to 0). Skip enforcement.
	if (baseLimit <= 0) {
		return { allowed: true, remaining: 0, limit: 0 };
	}

	const window = getWindowSeconds();
	const key = `rate_limit:org_path:${organizationId}:${config.key}`;

	try {
		const now = Date.now();
		// eslint-disable-next-line no-mixed-operators
		const windowStart = now - window * 1000;

		await redisClient.zremrangebyscore(key, "-inf", windowStart);
		const currentCount = await redisClient.zcard(key);

		// Only resolve the spend tier (an extra DB/Redis lookup) once the base
		// limit is reached; below it the request is admitted without it.
		let limit = baseLimit;
		let multiplier = 1;
		if (currentCount >= baseLimit) {
			multiplier = await getMultiplier();
			limit = Math.floor(baseLimit * multiplier);
		}

		if (currentCount >= limit) {
			const oldestEntry = await redisClient.zrange(key, 0, 0, "WITHSCORES");
			const retryAfter =
				oldestEntry.length > 1
					? Math.max(
							1,
							Math.ceil(
								// eslint-disable-next-line no-mixed-operators
								(parseInt(oldestEntry[1], 10) + window * 1000 - now) / 1000,
							),
						)
					: window;

			logger.info("Org rate limit exceeded", {
				organizationId,
				path: config.key,
				planClass,
				currentCount,
				limit,
				multiplier,
				retryAfter,
			});

			return { allowed: false, retryAfter, remaining: 0, limit };
		}

		const member = `${now}:${randomUUID()}`;
		await redisClient.zadd(key, now, member);
		await redisClient.expire(key, window * 2);

		return {
			allowed: true,
			remaining: Math.max(0, limit - currentCount - 1),
			limit,
		};
	} catch (error) {
		logger.error("Error checking org rate limit:", error as Error);
		// Fail open so Redis issues never block users.
		return { allowed: true, remaining: 0, limit: baseLimit };
	}
}
