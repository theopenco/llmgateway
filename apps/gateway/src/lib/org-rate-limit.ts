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
	getOrgInflightLimit,
	getOrgInflightStaleSeconds,
	getOrgSpendTier,
	getPlanClass,
	getRateLimitEnvNumber,
	INFLIGHT_LIMITED_KEYS,
	isOrgRateLimitEnabled,
	orgInflightKey,
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
	getOrgInflightLimit,
	getOrgSpendTier,
	getPlanClass,
	INFLIGHT_LIMITED_KEYS,
	PATH_RATE_LIMITS,
	resolvePathRateLimit,
};
export type { PathRateLimitConfig, PlanClass, ResolvedSpendTier };

// isOrgRateLimitEnabled moved to @llmgateway/shared so the API's limits
// display honors the same switch as enforcement; re-exported for imports.
export { isOrgRateLimitEnabled };

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
	// Inactive/revoked keys must not consume the organization's buckets:
	// downstream handlers reject them with a 401 anyway, and counting them
	// would let anyone holding a revoked token throttle the org's valid keys.
	if (!apiKey || apiKey.status !== "active") {
		return null;
	}
	// Same for end-user session tokens whose session can no longer serve
	// requests (expired, or frozen wallet/customer/project) — downstream
	// rejects them, so they must not throttle the developer org's valid keys.
	// Mirrors the checks in lib/end-user-session.ts.
	const session = apiKey.endUserSession;
	if (
		session &&
		(new Date(session.expiresAt).getTime() < Date.now() ||
			session.walletStatus !== "active" ||
			session.endCustomerStatus !== "active" ||
			session.projectStatus !== "active")
	) {
		return null;
	}
	const project = await findProjectById(apiKey.projectId);
	// Keys of archived projects stay "active" in the DB but every request is
	// rejected downstream — don't let them consume the shared buckets either.
	if (!project || project.status === "deleted") {
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
					// creditsCost, NOT cost: only credits-billed usage qualifies. Total
					// `cost` includes BYOK usage, which the spend caps don't bound —
					// counting it would let free/stolen-provider-key traffic buy top
					// tiers in a day.
					cdb
						.select({
							total: sql<string>`COALESCE(SUM(CAST(${projectHourlyStats.creditsCost} AS NUMERIC)), 0)`,
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

export interface InflightAcquisition {
	allowed: boolean;
	limit: number;
	/** Releases the held slot; present only when a slot was actually taken. */
	release?: () => void;
}

/**
 * Acquire one slot in the organization's fleet-wide in-flight inference
 * budget, backed by a Redis sorted set of active request slots. Unlike the
 * sliding-window RPM counter, entries are removed when the response settles
 * (via the returned `release`), so the count tracks live concurrency rather
 * than request rate.
 *
 * Slots whose score is older than the stale window are reaped on every
 * acquisition: a pod that crashed mid-stream never calls `release`, and
 * without reaping its phantom slots would throttle the org forever. The
 * window sits above the longest legitimate request, so a legit long-runner
 * at worst frees its slot early — erring permissive, never restrictive.
 *
 * `getMaxLimit` is resolved lazily, mirroring `checkOrgRateLimit`'s spend-tier
 * multiplier: under `baseLimit` the request is admitted without it, so the
 * (cached but still extra) tier lookup only runs once an org is actually at
 * its base. Tiers can only raise the limit, so under-base admits are always
 * correct.
 *
 * Mirrors `checkOrgRateLimit`'s failure policy: any Redis error fails open so
 * limiter outages never block traffic.
 */
export async function acquireOrgInflightSlot(
	organizationId: string,
	baseLimit: number,
	getMaxLimit: () => Promise<number>,
	endpointKey: string,
): Promise<InflightAcquisition> {
	// A non-positive limit means concurrency is unlimited for this org class
	// (e.g. an operator set the override to 0). Skip enforcement.
	if (baseLimit <= 0) {
		return { allowed: true, limit: 0 };
	}

	const key = orgInflightKey(organizationId);
	const staleSeconds = getOrgInflightStaleSeconds();

	// Explicit pipelines, NOT bare awaited commands: the release below runs in
	// the response-close/finally context, where a bare command can wedge
	// ioredis's auto-pipelining (the queued command's flush is never scheduled,
	// silently hanging every later command on the shared client). pipeline()
	// bypasses auto-pipelining and also halves the acquire round trips.
	try {
		const now = Date.now();
		// eslint-disable-next-line no-mixed-operators
		const staleBefore = now - staleSeconds * 1000;

		const checkResults = await redisClient
			.pipeline()
			.zremrangebyscore(key, "-inf", staleBefore)
			.zcard(key)
			.exec();
		const zcardResult = checkResults?.[1];
		if (!zcardResult || zcardResult[0]) {
			throw zcardResult?.[0] ?? new Error("org inflight pipeline failed");
		}
		const currentCount = Number(zcardResult[1]);

		// Only resolve the tier-elevated ceiling (an extra cached lookup) once
		// the base limit is reached; below it the request is admitted without it.
		let limit = baseLimit;
		if (currentCount >= baseLimit) {
			limit = Math.max(baseLimit, await getMaxLimit());
		}

		if (currentCount >= limit) {
			logger.info("Org inflight limit exceeded", {
				organizationId,
				endpointKey,
				currentCount,
				limit,
			});

			await recordLimitHit({
				organizationId,
				limitType: "concurrency",
				endpointKey,
			});

			return { allowed: false, limit };
		}

		const member = `${now}:${randomUUID()}`;
		// The expire is a safety net: if every holder crashes, the whole key
		// expires once no acquisition refreshes it, instead of lingering until
		// the next reap.
		await redisClient
			.pipeline()
			.zadd(key, now, member)
			.expire(key, staleSeconds)
			.exec();

		return {
			allowed: true,
			limit,
			release: () => {
				redisClient
					.pipeline()
					.zrem(key, member)
					.exec()
					.catch((error: unknown) => {
						logger.error("Error releasing org inflight slot:", error as Error);
					});
			},
		};
	} catch (error) {
		logger.error("Error acquiring org inflight slot:", error as Error);
		// Fail open so Redis issues never block users.
		return { allowed: true, limit: baseLimit };
	}
}
