import { getCache, setCache } from "@llmgateway/cache";
import { logger } from "@llmgateway/logger";

import { db } from "./db.js";

export async function isCachingEnabled(
	projectId: string,
): Promise<{ enabled: boolean; duration: number }> {
	try {
		const configCacheKey = `project_cache_config:${projectId}`;
		const cachedConfig = await getCache(configCacheKey);

		if (cachedConfig) {
			return cachedConfig;
		}

		const project = await db.query.project.findFirst({
			where: {
				id: {
					eq: projectId,
				},
			},
		});

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
