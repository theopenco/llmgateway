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

import { findApiKeyByToken, findProjectById } from "./cached-queries.js";

/**
 * Per-organization, per-path rate limiting for the gateway.
 *
 * Every gateway path (`/v1/chat/completions`, `/v1/models`, ...) has a default
 * requests-per-minute (RPM) limit that can be overridden via an environment
 * variable. Limits are scoped per organization and are multiplied by a
 * spend-tier factor so that organizations with higher lifetime spend get more
 * headroom. Enterprise organizations are excluded entirely (handled in the
 * middleware).
 *
 * The lifetime spend used to pick the tier is cached in Redis to avoid an
 * aggregation query on the hot path.
 */

export interface PathRateLimitConfig {
	/** Stable identifier used in the Redis key and env var name. */
	key: string;
	/** Path prefix this config applies to. */
	prefix: string;
	/** Default requests per minute (per org) before any spend-tier multiplier. */
	defaultRpm: number;
	/** Env var that overrides `defaultRpm`. */
	envVar: string;
}

/**
 * Ordered list of path configs. The first entry whose prefix matches the
 * request path wins, so more specific prefixes must come before less specific
 * ones (e.g. `/v1/audio/speech` before any hypothetical `/v1/audio`).
 */
export const PATH_RATE_LIMITS: readonly PathRateLimitConfig[] = [
	{
		key: "chat_completions",
		prefix: "/v1/chat/completions",
		defaultRpm: 600,
		envVar: "GATEWAY_RATE_LIMIT_CHAT_COMPLETIONS_RPM",
	},
	{
		key: "messages",
		prefix: "/v1/messages",
		defaultRpm: 600,
		envVar: "GATEWAY_RATE_LIMIT_MESSAGES_RPM",
	},
	{
		key: "responses",
		prefix: "/v1/responses",
		defaultRpm: 600,
		envVar: "GATEWAY_RATE_LIMIT_RESPONSES_RPM",
	},
	{
		key: "embeddings",
		prefix: "/v1/embeddings",
		defaultRpm: 1200,
		envVar: "GATEWAY_RATE_LIMIT_EMBEDDINGS_RPM",
	},
	{
		key: "moderations",
		prefix: "/v1/moderations",
		defaultRpm: 1200,
		envVar: "GATEWAY_RATE_LIMIT_MODERATIONS_RPM",
	},
	{
		key: "models",
		prefix: "/v1/models",
		defaultRpm: 1200,
		envVar: "GATEWAY_RATE_LIMIT_MODELS_RPM",
	},
	{
		key: "images",
		prefix: "/v1/images",
		defaultRpm: 300,
		envVar: "GATEWAY_RATE_LIMIT_IMAGES_RPM",
	},
	{
		key: "audio_speech",
		prefix: "/v1/audio/speech",
		defaultRpm: 300,
		envVar: "GATEWAY_RATE_LIMIT_AUDIO_SPEECH_RPM",
	},
	{
		key: "videos",
		prefix: "/v1/videos",
		defaultRpm: 120,
		envVar: "GATEWAY_RATE_LIMIT_VIDEOS_RPM",
	},
];

/**
 * Spend tiers. A higher lifetime spend grants a larger multiplier on top of the
 * per-path base limit. Thresholds and multipliers are overridable via env vars.
 */
interface SpendTier {
	/** Lifetime spend (USD) at or above which this tier applies. */
	thresholdEnvVar: string;
	defaultThreshold: number;
	multiplierEnvVar: string;
	defaultMultiplier: number;
}

const SPEND_TIERS: readonly SpendTier[] = [
	{
		thresholdEnvVar: "GATEWAY_RATE_LIMIT_TIER_3_THRESHOLD",
		defaultThreshold: 50_000,
		multiplierEnvVar: "GATEWAY_RATE_LIMIT_TIER_3_MULTIPLIER",
		defaultMultiplier: 10,
	},
	{
		thresholdEnvVar: "GATEWAY_RATE_LIMIT_TIER_2_THRESHOLD",
		defaultThreshold: 10_000,
		multiplierEnvVar: "GATEWAY_RATE_LIMIT_TIER_2_MULTIPLIER",
		defaultMultiplier: 4,
	},
	{
		thresholdEnvVar: "GATEWAY_RATE_LIMIT_TIER_1_THRESHOLD",
		defaultThreshold: 1_000,
		multiplierEnvVar: "GATEWAY_RATE_LIMIT_TIER_1_MULTIPLIER",
		defaultMultiplier: 2,
	},
];

function getEnvNumber(name: string, fallback: number): number {
	const raw = process.env[name];
	if (raw === undefined || raw === "") {
		return fallback;
	}
	const parsed = Number(raw);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/**
 * Whether org rate limiting is enforced. Enabled by default in every
 * environment except the e2e suite (which fires many requests against a single
 * org and would otherwise be throttled). Set `GATEWAY_RATE_LIMIT_ENABLED`
 * explicitly to override either way.
 */
export function isOrgRateLimitEnabled(): boolean {
	const explicit = process.env.GATEWAY_RATE_LIMIT_ENABLED;
	if (explicit !== undefined) {
		return explicit === "true";
	}
	return process.env.E2E_TEST !== "true";
}

/** The sliding window size in seconds (shared across paths). */
function getWindowSeconds(): number {
	return getEnvNumber("GATEWAY_RATE_LIMIT_WINDOW_SECONDS", 60);
}

/**
 * Resolve the rate limit config for a request path, or `null` if the path is
 * not rate limited (e.g. `/`, `/metrics`, `/docs`, `/mcp`).
 */
export function resolvePathRateLimit(path: string): PathRateLimitConfig | null {
	for (const config of PATH_RATE_LIMITS) {
		if (path === config.prefix || path.startsWith(`${config.prefix}/`)) {
			return config;
		}
	}
	return null;
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
 * stats and cached in Redis. The cache TTL is intentionally coarse: crossing a
 * spend tier boundary does not need to take effect instantly.
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

		const ttl = getEnvNumber("GATEWAY_RATE_LIMIT_SPEND_CACHE_SECONDS", 900);
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

/**
 * The spend-tier multiplier applied to the per-path base limit for a given
 * lifetime spend.
 */
export function getSpendTierMultiplier(lifetimeSpend: number): {
	tier: number;
	multiplier: number;
} {
	for (let i = 0; i < SPEND_TIERS.length; i++) {
		const tier = SPEND_TIERS[i];
		const threshold = getEnvNumber(tier.thresholdEnvVar, tier.defaultThreshold);
		if (lifetimeSpend >= threshold) {
			return {
				tier: SPEND_TIERS.length - i,
				multiplier: getEnvNumber(tier.multiplierEnvVar, tier.defaultMultiplier),
			};
		}
	}
	return {
		tier: 0,
		multiplier: getEnvNumber("GATEWAY_RATE_LIMIT_TIER_0_MULTIPLIER", 1),
	};
}

/**
 * Resolve the effective per-minute limit for an org on a given path, combining
 * the (possibly env-overridden) base RPM with the spend-tier multiplier.
 */
export function getEffectiveLimit(
	config: PathRateLimitConfig,
	multiplier: number,
): number {
	const base = getEnvNumber(config.envVar, config.defaultRpm);
	return Math.floor(base * multiplier);
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
 * `getMultiplier` is resolved lazily: the spend tier only matters once the org
 * is already at or above its base limit, so the (cached but still extra) spend
 * lookup is skipped entirely for the common under-limit case. Higher tiers can
 * only raise the limit, so a request under the base limit is always allowed
 * regardless of tier.
 */
export async function checkOrgRateLimit(
	organizationId: string,
	config: PathRateLimitConfig,
	getMultiplier: () => Promise<number>,
): Promise<RateLimitResult> {
	const baseLimit = getEnvNumber(config.envVar, config.defaultRpm);

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
