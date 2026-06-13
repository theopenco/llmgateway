import { logger } from "@llmgateway/logger";

import { redisClient } from "./redis.js";

export const SWR_PREFIX = "swr:";
export const SWR_TABLE_INDEX_PREFIX = "swr:tables:";
export const SWR_THROTTLE_PREFIX = "swr:throttle:";
export const SWR_DEFAULT_TTL_SECONDS = 14400;
export const SWR_BATCH_SIZE = 500;

// The SWR mirror is only a fallback served when the underlying fetcher (a
// Postgres query) throws. The happy path never reads it, so it does NOT need to
// be rewritten on every successful request — doing so adds a Redis pipeline
// (SET + SADD/EXPIRE per table) to every hot-path query and, at hundreds of
// req/s with ~15-30 cached queries each, becomes a dominant source of Redis
// load. We instead refresh a given key's mirror at most once per throttle
// window, collapsing the per-request pipeline to a single conditional SET.
//
// The throttle marker lives in Redis (not in process memory) on purpose: the
// thing it gates — the mirror — also lives in Redis and can disappear out from
// under us (eviction, TTL, FLUSHDB, failover). An in-memory marker would
// desync from that and suppress re-priming for a full window even though the
// mirror is gone, silently removing the disaster fallback. A Redis-side marker
// is cleared by the same events that drop the mirror, so the next request
// re-primes immediately.
export const SWR_MIRROR_WRITE_THROTTLE_SECONDS = 30;

function throttleKey(key: string): string {
	return SWR_THROTTLE_PREFIX + key;
}

// Returns true if this caller won the throttle slot and should (re)write the
// mirror. Uses SET NX so exactly one caller per window per key wins. Fails open
// (returns true) on Redis error so an unavailable Redis never suppresses a
// write the caller would otherwise make.
async function claimMirrorWrite(key: string): Promise<boolean> {
	try {
		const result = await redisClient.set(
			throttleKey(key),
			"1",
			"EX",
			SWR_MIRROR_WRITE_THROTTLE_SECONDS,
			"NX",
		);
		return result === "OK";
	} catch (error) {
		logger.error(
			"Error claiming SWR mirror write throttle",
			error instanceof Error ? error : new Error(String(error)),
			{ key },
		);
		return true;
	}
}

const SWR_NONE_SENTINEL = "__swrNone" as const;

interface SwrNoneSentinel {
	[SWR_NONE_SENTINEL]: true;
}

function isNoneSentinel(value: unknown): value is SwrNoneSentinel {
	return (
		typeof value === "object" &&
		value !== null &&
		(value as Record<string, unknown>)[SWR_NONE_SENTINEL] === true
	);
}

export function getSwrStaleTtlSeconds(): number {
	const raw = process.env.SWR_STALE_TTL_SECONDS;
	if (!raw) {
		return SWR_DEFAULT_TTL_SECONDS;
	}
	const parsed = parseInt(raw, 10);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		return SWR_DEFAULT_TTL_SECONDS;
	}
	return parsed;
}

function swrKey(key: string): string {
	return SWR_PREFIX + key;
}

function tableIndexKey(table: string): string {
	return SWR_TABLE_INDEX_PREFIX + table;
}

async function writeMirror<T>(
	key: string,
	tables: string[],
	value: T,
): Promise<boolean> {
	try {
		const ttl = getSwrStaleTtlSeconds();
		const cacheKey = swrKey(key);
		const payload =
			value === undefined ? ({ [SWR_NONE_SENTINEL]: true } as const) : value;

		const pipeline = redisClient.pipeline();
		pipeline.set(cacheKey, JSON.stringify(payload), "EX", ttl);
		for (const table of tables) {
			const indexKey = tableIndexKey(table);
			pipeline.sadd(indexKey, cacheKey);
			pipeline.expire(indexKey, ttl + 60);
		}
		await pipeline.exec();
		return true;
	} catch (error) {
		logger.error(
			"Error writing SWR mirror",
			error instanceof Error ? error : new Error(String(error)),
			{ key },
		);
		return false;
	}
}

// Release the throttle slot so the next request retries the write. Used when a
// claimed write fails, so a transient Redis write error does not suppress the
// mirror (and weaken the stale fallback) for the whole throttle window.
async function releaseMirrorThrottle(key: string): Promise<void> {
	try {
		await redisClient.del(throttleKey(key));
	} catch {
		// Best-effort: the throttle key's own TTL bounds how long it can wrongly
		// suppress writes, so a failed release is non-fatal.
	}
}

async function readMirror<T>(
	key: string,
): Promise<{ hit: true; value: T } | { hit: false }> {
	const cached = await redisClient.get(swrKey(key));
	if (cached === null) {
		return { hit: false };
	}
	const parsed = JSON.parse(cached);
	if (isNoneSentinel(parsed)) {
		return { hit: true, value: undefined as T };
	}
	return { hit: true, value: parsed as T };
}

export async function swrWrap<T>(
	key: string,
	tables: string[],
	fetcher: () => Promise<T>,
): Promise<T> {
	let value: T;
	try {
		value = await fetcher();
	} catch (error) {
		try {
			const result = await readMirror<T>(key);
			if (result.hit) {
				logger.warn("serving SWR stale fallback", { key });
				return result.value;
			}
		} catch (redisError) {
			logger.error(
				"Error reading SWR mirror for fallback",
				redisError instanceof Error
					? redisError
					: new Error(String(redisError)),
				{ key },
			);
		}
		throw error;
	}

	if (await claimMirrorWrite(key)) {
		const wrote = await writeMirror(key, tables, value);
		if (!wrote) {
			await releaseMirrorThrottle(key);
		}
	}
	return value;
}

export async function invalidateSwrByTables(tables: string[]): Promise<void> {
	if (tables.length === 0) {
		return;
	}
	try {
		const allKeysToDelete = new Set<string>();
		for (const table of tables) {
			const members = await redisClient.smembers(tableIndexKey(table));
			for (const member of members) {
				allKeysToDelete.add(member);
			}
		}

		if (allKeysToDelete.size === 0) {
			for (const table of tables) {
				await redisClient.del(tableIndexKey(table));
			}
			return;
		}

		// Also drop the write-throttle markers for the invalidated keys so the
		// next fetch repopulates the mirror immediately instead of waiting out
		// the throttle window.
		const keysArray = Array.from(allKeysToDelete);
		const throttleKeys = keysArray.map((cacheKey) =>
			throttleKey(cacheKey.slice(SWR_PREFIX.length)),
		);
		const allUnlinkKeys = [...keysArray, ...throttleKeys];
		for (let i = 0; i < allUnlinkKeys.length; i += SWR_BATCH_SIZE) {
			const batch = allUnlinkKeys.slice(i, i + SWR_BATCH_SIZE);
			if (batch.length > 0) {
				await redisClient.unlink(...batch);
			}
		}

		for (const table of tables) {
			await redisClient.del(tableIndexKey(table));
		}
	} catch (error) {
		logger.error(
			"Error invalidating SWR mirrors by tables",
			error instanceof Error ? error : new Error(String(error)),
			{ tables },
		);
	}
}
