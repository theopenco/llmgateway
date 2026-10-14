import { redisClient } from "@llmgateway/cache";

import type { RateLimitMode, RateLimitSource } from "@llmgateway/db";

const MINUTE_SECONDS = 60;
const DAY_SECONDS = 60 * 60 * 24;

/**
 * Request windows count one slot per request when it is admitted. Token windows
 * count prompt + completion tokens once the request is logged, so they are
 * post-paid: a request is rejected only once a window is already at its cap.
 */
export const providerRateLimitWindows = {
	rpm: {
		headerSuffix: "RPM",
		label: "requests per minute",
		redisSuffix: "rpm",
		seconds: MINUTE_SECONDS,
		unit: "requests",
	},
	rpd: {
		headerSuffix: "RPD",
		label: "requests per day",
		redisSuffix: "rpd",
		seconds: DAY_SECONDS,
		unit: "requests",
	},
	tpm: {
		headerSuffix: "TPM",
		label: "tokens per minute",
		redisSuffix: "tpm",
		seconds: MINUTE_SECONDS,
		unit: "tokens",
	},
	tpd: {
		headerSuffix: "TPD",
		label: "tokens per day",
		redisSuffix: "tpd",
		seconds: DAY_SECONDS,
		unit: "tokens",
	},
} as const;

export type ProviderRateLimitWindow = keyof typeof providerRateLimitWindows;

export const PROVIDER_RATE_LIMIT_WINDOWS = Object.keys(
	providerRateLimitWindows,
) as ProviderRateLimitWindow[];

export const TOKEN_WINDOWS = PROVIDER_RATE_LIMIT_WINDOWS.filter(
	(window) => providerRateLimitWindows[window].unit === "tokens",
);

// Token windows are sliding windows over this many time buckets, so a
// per-minute window has 1s resolution and a per-day window 24min resolution.
const TOKEN_BUCKETS_PER_WINDOW = 60;

export interface ProviderRateLimitWindowState {
	currentCount: number;
	limit: number;
	remaining: number;
	rateLimited: boolean;
	retryAfter?: number;
	source: RateLimitSource;
	mode: RateLimitMode;
}

function getWindowDurationMs(window: ProviderRateLimitWindow): number {
	return providerRateLimitWindows[window].seconds * 1000;
}

function tokenBucketMs(window: ProviderRateLimitWindow): number {
	return getWindowDurationMs(window) / TOKEN_BUCKETS_PER_WINDOW;
}

/**
 * Read a request window: a sorted set with one member per admitted request.
 */
export async function readRequestWindow(
	key: string,
	window: ProviderRateLimitWindow,
	limit: number,
	now: number,
	source: RateLimitSource,
	mode: RateLimitMode,
): Promise<ProviderRateLimitWindowState> {
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
			mode,
		};
	}

	return {
		currentCount,
		limit,
		remaining: Math.max(0, limit - currentCount),
		rateLimited: false,
		source,
		mode,
	};
}

/**
 * Read a token window: a hash of bucket start (ms) to tokens used in that
 * bucket. Buckets that left the window are pruned on read.
 */
export async function readTokenWindow(
	key: string,
	window: ProviderRateLimitWindow,
	limit: number,
	now: number,
	source: RateLimitSource,
	mode: RateLimitMode,
): Promise<ProviderRateLimitWindowState> {
	const durationMs = getWindowDurationMs(window);
	const bucketMs = tokenBucketMs(window);
	const windowStart = now - durationMs;

	const buckets = await redisClient.hgetall(key);
	const live: Array<{ start: number; tokens: number }> = [];
	const stale: string[] = [];
	let currentCount = 0;
	for (const [field, value] of Object.entries(buckets)) {
		const start = Number(field);
		const tokens = Number(value);
		if (!Number.isFinite(start) || start + bucketMs <= windowStart) {
			stale.push(field);
			continue;
		}
		if (Number.isFinite(tokens) && tokens > 0) {
			live.push({ start, tokens });
			currentCount += tokens;
		}
	}
	if (stale.length > 0) {
		await redisClient.hdel(key, ...stale);
	}

	if (currentCount >= limit) {
		// Free capacity once enough of the oldest buckets slide out of the window.
		live.sort((a, b) => a.start - b.start);
		let remainingCount = currentCount;
		let freedAt = now + durationMs;
		for (const bucket of live) {
			remainingCount -= bucket.tokens;
			if (remainingCount < limit) {
				freedAt = bucket.start + bucketMs + durationMs;
				break;
			}
		}

		return {
			currentCount,
			limit,
			remaining: 0,
			rateLimited: true,
			retryAfter: Math.max(1, Math.ceil((freedAt - now) / 1000)),
			source,
			mode,
		};
	}

	return {
		currentCount,
		limit,
		remaining: Math.max(0, limit - currentCount),
		rateLimited: false,
		source,
		mode,
	};
}

export async function addWindowEntry(
	key: string,
	window: ProviderRateLimitWindow,
	now: number,
	member: string,
): Promise<void> {
	await redisClient.zadd(key, now, member);
	await redisClient.expire(key, providerRateLimitWindows[window].seconds * 2);
}

export async function addTokenWindowEntry(
	key: string,
	window: ProviderRateLimitWindow,
	now: number,
	tokens: number,
): Promise<void> {
	const bucketMs = tokenBucketMs(window);
	const bucketStart = Math.floor(now / bucketMs) * bucketMs;
	await redisClient.hincrby(key, String(bucketStart), Math.ceil(tokens));
	await redisClient.expire(key, providerRateLimitWindows[window].seconds * 2);
}
