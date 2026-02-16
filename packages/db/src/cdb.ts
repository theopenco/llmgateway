import { drizzle } from "drizzle-orm/node-postgres";

import { redisClient } from "@llmgateway/cache";

import { pool } from "./db.js";
import { RedisCache } from "./redis-cache.js";
import { relations } from "./relations.js";

// Use the shared pool from db.ts instead of creating a separate pool
// This prevents connection exhaustion from having multiple pools
const _cdb = drizzle({
	client: pool,
	casing: "snake_case",
	relations,
	cache: new RedisCache(redisClient),
});

/**
 * Cached database client type that excludes the `.query` property.
 *
 * IMPORTANT: The relational query API (db.query.table.findFirst/findMany)
 * does NOT go through Drizzle's cache layer. Only the select builder pattern
 * (db.select().from()) is cached.
 *
 * This type prevents accidental use of non-cacheable queries at compile time.
 */
export type CacheableDb = Omit<typeof _cdb, "query">;

/**
 * Cached database client with Redis caching.
 *
 * IMPORTANT: Only use db.select().from() queries with this client.
 * The .query property is intentionally omitted because relational queries
 * (db.query.table.findFirst/findMany) bypass Drizzle's cache layer.
 *
 * See: packages/db/src/cdb-resilience.spec.ts for documentation.
 */
export const cdb: CacheableDb = _cdb;

/**
 * Internal cached database client with full access (including .query).
 * Only use this for tests or when you explicitly need uncached relational queries.
 *
 * @internal
 */
export const _internalCdb = _cdb;
