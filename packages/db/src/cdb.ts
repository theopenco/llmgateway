import { drizzle } from "drizzle-orm/node-postgres";

import { redisClient } from "@llmgateway/cache";
import { logger } from "@llmgateway/logger";

import { pool } from "./db.js";
import { RedisCache } from "./redis-cache.js";
import { relations } from "./relations.js";

// Use the shared pool from db.ts instead of creating a separate pool
// This prevents connection exhaustion from having multiple pools
export const cdb = drizzle({
	client: pool,
	casing: "snake_case",
	relations,
	cache: new RedisCache(redisClient),
});

// closeCachedDatabase is now an alias for closeDatabase since they share the same pool
// Kept for backwards compatibility - prefer using closeDatabase from db.ts
export async function closeCachedDatabase(): Promise<void> {
	logger.warn(
		"closeCachedDatabase is deprecated - use closeDatabase instead (pools are now shared)",
	);
	// Don't actually close the pool here since it's shared
	// The main closeDatabase function should be called once at shutdown
}
