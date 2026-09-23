import { redisClient, SWR_PREFIX } from "@llmgateway/cache";
import { logger } from "@llmgateway/logger";

const SCAN_COUNT = 500;

// Everything that holds serialized database rows: the Drizzle query cache with
// its table/tag indices, and the SWR fallback mirrors.
function rowCachePatterns(): string[] {
	return [
		"drizzle:cache:*",
		"drizzle:table_keys:*",
		"drizzle:tags:*",
		"drizzle:tables:*",
		`${SWR_PREFIX}*`,
	];
}

async function unlinkByPattern(pattern: string): Promise<number> {
	let cursor = "0";
	let removed = 0;

	do {
		const [next, keys] = await redisClient.scan(
			cursor,
			"MATCH",
			pattern,
			"COUNT",
			SCAN_COUNT,
		);
		cursor = next;
		if (keys.length > 0) {
			await redisClient.unlink(...keys);
			removed += keys.length;
		}
	} while (cursor !== "0");

	return removed;
}

/**
 * Drop every cached database row.
 *
 * Called after migrations apply so rows cached under the previous column layout
 * cannot be served to code that expects the new one. SCAN rather than KEYS, so
 * this is safe to run against a production Redis.
 *
 * Best-effort: cache entries expire on their own TTL, so a Redis hiccup here
 * must not fail a deploy.
 */
export async function clearRowCaches(): Promise<void> {
	try {
		let removed = 0;
		for (const pattern of rowCachePatterns()) {
			removed += await unlinkByPattern(pattern);
		}
		logger.info("Cleared cached database rows", { removed });
	} catch (error) {
		logger.error(
			"Error clearing cached database rows",
			error instanceof Error ? error : new Error(String(error)),
		);
	}
}
