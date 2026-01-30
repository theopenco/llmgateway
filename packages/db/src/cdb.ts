import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { redisClient } from "@llmgateway/cache";
import { logger } from "@llmgateway/logger";

import { RedisCache } from "./redis-cache.js";
import { relations } from "./relations.js";

const cachedPool = new Pool({
	connectionString:
		process.env.DATABASE_URL || "postgres://postgres:pw@localhost:5432/db",
	// Explicit pool configuration for production reliability
	max: Number(process.env.DATABASE_POOL_MAX) || 20, // Maximum connections in pool
	min: Number(process.env.DATABASE_POOL_MIN) || 2, // Minimum connections to maintain
	idleTimeoutMillis: Number(process.env.DATABASE_IDLE_TIMEOUT_MS) || 30000, // Close idle connections after 30s
	connectionTimeoutMillis:
		Number(process.env.DATABASE_CONNECTION_TIMEOUT_MS) || 10000, // Fail fast if can't connect in 10s
});

export const cdb = drizzle({
	client: cachedPool,
	casing: "snake_case",
	relations,
	cache: new RedisCache(redisClient),
});

export async function closeCachedDatabase(): Promise<void> {
	try {
		await cachedPool.end();
		logger.info("Cached database connection pool closed");
	} catch (error) {
		logger.error(
			"Error closing cached database connection pool",
			error instanceof Error ? error : new Error(String(error)),
		);
		throw error;
	}
}
