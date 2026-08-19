import { storageRedisClient } from "@llmgateway/cache";

/**
 * Backend-neutral storage for Responses API state. Keys are flat strings,
 * values are opaque JSON strings, and every write carries a TTL, so the
 * interface can be implemented by Redis today and an object store (GCS/S3
 * with a bucket lifecycle rule for the TTL) later without touching the
 * response-state domain logic built on top.
 */
export interface ResponsesStorage {
	set: (key: string, value: string, ttlSeconds: number) => Promise<void>;
	setMany: (
		entries: { key: string; value: string }[],
		ttlSeconds: number,
	) => Promise<void>;
	get: (key: string) => Promise<string | null>;
	getMany: (keys: string[]) => Promise<(string | null)[]>;
}

class RedisResponsesStorage implements ResponsesStorage {
	public async set(
		key: string,
		value: string,
		ttlSeconds: number,
	): Promise<void> {
		await storageRedisClient.set(key, value, "EX", ttlSeconds);
	}

	public async setMany(
		entries: { key: string; value: string }[],
		ttlSeconds: number,
	): Promise<void> {
		if (entries.length === 0) {
			return;
		}
		const pipeline = storageRedisClient.pipeline();
		for (const entry of entries) {
			pipeline.set(entry.key, entry.value, "EX", ttlSeconds);
		}
		await pipeline.exec();
	}

	public async get(key: string): Promise<string | null> {
		return await storageRedisClient.get(key);
	}

	public async getMany(keys: string[]): Promise<(string | null)[]> {
		if (keys.length === 0) {
			return [];
		}
		return await storageRedisClient.mget(...keys);
	}
}

let redisStorage: RedisResponsesStorage | undefined;
let storageOverride: ResponsesStorage | undefined;

export function setResponsesStorageForTesting(
	storage: ResponsesStorage | undefined,
): void {
	storageOverride = storage;
}

export function getResponsesStorage(): ResponsesStorage {
	if (storageOverride) {
		return storageOverride;
	}
	const driver = process.env.RESPONSES_STORAGE_DRIVER ?? "redis";
	if (driver === "redis") {
		redisStorage ??= new RedisResponsesStorage();
		return redisStorage;
	}
	throw new Error(`Unknown RESPONSES_STORAGE_DRIVER: ${driver}`);
}

// Fail fast on a misconfigured driver at import time (gateway startup)
// instead of on the first stateful Responses API request.
getResponsesStorage();
