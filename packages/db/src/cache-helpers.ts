import { eq } from "drizzle-orm";

import { getCache, setCache } from "@llmgateway/cache";
import { logger } from "@llmgateway/logger";

import { db } from "./db.js";
import { project as projectTable } from "./schema.js";

/**
 * Check if caching is enabled for a project.
 *
 * Note: This function uses its own Redis-based cache layer (not Drizzle's cache)
 * for the configuration lookup, but the underlying database query uses the
 * select builder pattern for consistency with the rest of the codebase.
 */
export async function isCachingEnabled(
	projectId: string,
): Promise<{ enabled: boolean; duration: number }> {
	try {
		const configCacheKey = `project_cache_config:${projectId}`;
		const cachedConfig = await getCache(configCacheKey);

		if (cachedConfig) {
			return cachedConfig;
		}

		// Use select builder pattern instead of relational query API
		// to ensure consistency with the cacheable query pattern used elsewhere
		const results = await db
			.select()
			.from(projectTable)
			.where(eq(projectTable.id, projectId))
			.limit(1);

		const project = results[0];

		if (!project) {
			return { enabled: false, duration: 0 };
		}

		const config = {
			enabled: project.cachingEnabled || false,
			duration: project.cacheDurationSeconds || 60,
		};

		await setCache(configCacheKey, config, 300);

		return config;
	} catch (error) {
		logger.error("Error checking if caching is enabled:", error as Error);
		throw error;
	}
}

// Re-export cache functions for convenience
export {
	generateCacheKey,
	generateStreamingCacheKey,
	getCache,
	getStreamingCache,
	setCache,
	setStreamingCache,
} from "@llmgateway/cache";
