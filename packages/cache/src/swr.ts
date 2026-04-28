import { logger } from "@llmgateway/logger";

import { redisClient } from "./redis.js";

export const SWR_PREFIX = "swr:";
export const SWR_TABLE_INDEX_PREFIX = "swr:tables:";
export const SWR_DEFAULT_TTL_SECONDS = 14400;
export const SWR_BATCH_SIZE = 500;

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
): Promise<void> {
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
	} catch (error) {
		logger.error(
			"Error writing SWR mirror",
			error instanceof Error ? error : new Error(String(error)),
			{ key },
		);
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

	await writeMirror(key, tables, value);
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

		const keysArray = Array.from(allKeysToDelete);
		for (let i = 0; i < keysArray.length; i += SWR_BATCH_SIZE) {
			const batch = keysArray.slice(i, i + SWR_BATCH_SIZE);
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
