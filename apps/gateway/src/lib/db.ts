import { redisClient } from "@llmgateway/cache";
import { createCachedDb, createDbQueries } from "@llmgateway/db";

// Re-export everything from @llmgateway/db except db to avoid conflicts
export * from "@llmgateway/db";

// Create cached database instance
const {
	db: cachedDb,
	closeDatabase: closeCachedDatabase,
	cache,
} = createCachedDb(redisClient);

// Create database queries using the cached db and cache
const dbQueries = createDbQueries(cachedDb, cache);

// Export the cached db instance and queries
export const db = cachedDb;
export const closeDatabase = closeCachedDatabase;
export const {
	getProject,
	getOrganization,
	getProviderKey,
	getCustomProviderKey,
	checkCustomProviderExists,
	isCachingEnabled,
} = dbQueries;
