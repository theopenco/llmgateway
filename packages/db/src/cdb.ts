import { drizzle } from "drizzle-orm/node-postgres";

import { redisClient, setSwrSchemaVersion } from "@llmgateway/cache";

import { pool } from "./db.js";
import { RedisCache } from "./redis-cache.js";
import { relations } from "./relations.js";
import { SCHEMA_CACHE_VERSION } from "./schema-cache-version.js";

// Stamp the column layout on the SWR mirrors too, so a fallback row serialized
// under a different schema is discarded instead of served with missing fields.
setSwrSchemaVersion(SCHEMA_CACHE_VERSION);

// Exported so writers that bypass this client (the worker debits credits via
// the plain `db` client inside a transaction) can still evict tagged entries.
export const drizzleCache = new RedisCache(redisClient);

// Use the shared pool from db.ts instead of creating a separate pool
// This prevents connection exhaustion from having multiple pools
const _cdb = drizzle({
	client: pool,
	relations,
	cache: drizzleCache,
});

/**
 * Cached database client type that excludes the `.query` property.
 *
 * With the "all" cache strategy, Drizzle caches every select builder query
 * (db.select().from()) and every relational query (db.query.table.find*)
 * unless the query opts out (`.$withCache(false)` / `withCache: false`).
 * Omitting `.query` keeps reads on this client to the select builder, whose
 * cache config (tag, TTL) is set explicitly at each call site.
 *
 * Transactions on this client inherit the cache: reads inside
 * `cdb.transaction` must opt out to see the transaction's own writes and to
 * take row locks.
 */
export type CacheableDb = Omit<typeof _cdb, "query">;

/**
 * Cached database client with Redis caching.
 *
 * Only use db.select().from() queries with this client; see CacheableDb.
 *
 * See: packages/db/src/cdb-resilience.spec.ts for documentation.
 */
export const cdb: CacheableDb = _cdb;

/**
 * Internal cached database client with full access (including .query).
 * Only use this for tests. Its relational queries are cached too.
 *
 * @internal
 */
export const _internalCdb = _cdb;
