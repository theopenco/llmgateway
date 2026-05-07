import { eq, getTableName } from "drizzle-orm";

import { swrWrap } from "@llmgateway/cache";
import { logger } from "@llmgateway/logger";

import { cdb } from "./cdb.js";
import { project as projectTable } from "./schema.js";

const projectTableName = getTableName(projectTable);

/**
 * Check if caching is enabled for a project.
 *
 * Uses the cached database client (cdb) plus swrWrap so the answer survives a
 * Postgres outage (falls back to the last-known value for up to SWR TTL).
 */
export async function isCachingEnabled(
	projectId: string,
): Promise<{ enabled: boolean; duration: number }> {
	try {
		return await swrWrap(
			`project:cachingEnabled:${projectId}`,
			[projectTableName],
			async () => {
				const results = await cdb
					.select({
						cachingEnabled: projectTable.cachingEnabled,
						cacheDurationSeconds: projectTable.cacheDurationSeconds,
					})
					.from(projectTable)
					.where(eq(projectTable.id, projectId))
					.limit(1);

				const project = results[0];

				if (!project) {
					return { enabled: false, duration: 0 };
				}

				return {
					enabled: project.cachingEnabled || false,
					duration: project.cacheDurationSeconds || 60,
				};
			},
		);
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
