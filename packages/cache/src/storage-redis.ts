import { Redis } from "ioredis";

import { logger } from "@llmgateway/logger";

// Dedicated "storage" Redis instance for bulk data: Responses API state
// (30-day retention) and gateway response caching. Kept separate from the
// main Redis, which is reserved for critical infrastructure (log queue,
// rate limiting, preferred-provider state, video jobs).
//
// The fallback to the main Redis settings is all-or-nothing: with no
// STORAGE_REDIS_* var set, single-instance deployments keep working with
// zero extra configuration; once any STORAGE_REDIS_* var is set, the
// remaining fields are NOT inherited from REDIS_* (a dedicated passwordless
// instance must not inherit the main instance's password).
const hasStorageRedisConfig =
	process.env.STORAGE_REDIS_HOST !== undefined ||
	process.env.STORAGE_REDIS_PORT !== undefined ||
	process.env.STORAGE_REDIS_PASSWORD !== undefined;

export const storageRedisClient = new Redis({
	host: hasStorageRedisConfig
		? (process.env.STORAGE_REDIS_HOST ?? "localhost")
		: (process.env.REDIS_HOST ?? "localhost"),
	port: hasStorageRedisConfig
		? Number(process.env.STORAGE_REDIS_PORT) || 6379
		: Number(process.env.REDIS_PORT) || 6379,
	password: hasStorageRedisConfig
		? process.env.STORAGE_REDIS_PASSWORD
		: process.env.REDIS_PASSWORD,
	enableAutoPipelining: true,
	// Connect on first command. Many consumers of @llmgateway/cache (seed
	// script, one-off scripts, the API) never touch storage functions; an
	// eager connection would keep their event loop alive on exit unless every
	// such path remembered to quit this client too.
	lazyConnect: true,
});

storageRedisClient.on("error", (err) =>
	logger.error("Storage Redis Client Error", err),
);

export async function closeStorageRedisClient(): Promise<void> {
	try {
		await storageRedisClient.disconnect();
		logger.info("Storage Redis client disconnected");
	} catch (error) {
		logger.error("Error disconnecting storage Redis client", error);
		throw error;
	}
}
