import { randomUUID } from "node:crypto";

import { recordLimitHit } from "@llmgateway/actions";
import { redisClient, swrWrap } from "@llmgateway/cache";
import {
	and,
	cdb,
	eq,
	getTableName,
	sql,
	project as projectTable,
	projectHourlyStats,
	transaction as transactionTable,
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

const projectHourlyStatsTableName = getTableName(projectHourlyStats);
const transactionTableName = getTableName(transactionTable);

/**
 * Tier-qualifying lifetime spend (USD) for an organization: usage aggregated
 * from hourly project stats MINUS every completed refund, floored at 0. The
 * deduction is what stops a fraudster from buying a higher tier with usage
 * paid for by a later-refunded (e.g. stolen-card) top-up — refunded money
 * must not raise RPM multipliers, spend caps, or top-up allowances.
 *
 * Uses the standard swrWrap + cdb layers, but with PINNED fixed-TTL Drizzle
 * cache entries (`autoInvalidate: false`, `GATEWAY_RATE_LIMIT_SPEND_CACHE_SECONDS`,
 * default 900s) instead of the default short auto-invalidating ones: the tier
 * aggregate is coarse and does not need to reflect writes instantly, and a
 * short TTL would re-run the full SUMs at gateway throughput. swrWrap adds
 * in-flight coalescing (concurrent requests share one aggregate query at each
 * expiry instead of stampeding) and the stale mirror as a Postgres-outage
 * fallback.
 */
export async function getOrganizationLifetimeSpend(
	organizationId: string,
): Promise<number> {
	try {
		const ttl = Math.max(
			1,
			getRateLimitEnvNumber("GATEWAY_RATE_LIMIT_SPEND_CACHE_SECONDS", 900),
		);
		return await swrWrap(
			`orgSpend:${organizationId}`,
			[projectHourlyStatsTableName, transactionTableName],
			async () => {
				const [usageRows, refundRows] = await Promise.all([
					cdb
						.select({
							total: sql<string>`COALESCE(SUM(CAST(${projectHourlyStats.cost} AS NUMERIC)), 0)`,
						})
						.from(projectHourlyStats)
						.innerJoin(
							projectTable,
							eq(projectHourlyStats.projectId, projectTable.id),
						)
						.where(eq(projectTable.organizationId, organizationId))
						.$withCache({
							tag: `org-spend:${organizationId}`,
							autoInvalidate: false,
							config: { ex: ttl },
						}),
					// `credit_refund.amount` is the positive gross USD given back.
					cdb
						.select({
							total: sql<string>`COALESCE(SUM(CAST(${transactionTable.amount} AS NUMERIC)), 0)`,
						})
						.from(transactionTable)
						.where(
							and(
								eq(transactionTable.organizationId, organizationId),
								eq(transactionTable.type, "credit_refund"),
								eq(transactionTable.status, "completed"),
							),
						)
						.$withCache({
							tag: `org-spend-refunds:${organizationId}`,
							autoInvalidate: false,
							config: { ex: ttl },
						}),
				]);

				const usage = Number(usageRows[0]?.total ?? "0") || 0;
				const refunded = Number(refundRows[0]?.total ?? "0") || 0;
				return Math.max(0, usage - refunded);
			},
		);
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

			await recordLimitHit({
				organizationId,
				limitType: "rpm",
				endpointKey: config.key,
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
