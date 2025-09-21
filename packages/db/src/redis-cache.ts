import { Cache, type MutationOption } from "drizzle-orm/cache/core";

import { redisClient } from "@llmgateway/cache";
import { logger } from "@llmgateway/logger";

interface CacheConfig {
	ex?: number;
	px?: number;
	exat?: number;
	pxat?: number;
	keepTtl?: boolean;
	hexOptions?: "NX" | "nx" | "XX" | "xx" | "GT" | "gt" | "LT" | "lt";
}

export class RedisCache extends Cache {
	private readonly keyPrefix = "drizzle:cache:";
	private readonly tablePrefix = "drizzle:tables:";
	private readonly defaultTtl = 300; // 5 minutes in seconds

	strategy(): "all" {
		return "all";
	}

	async get(
		key: string,
		tables: string[],
		isTag: boolean,
		isAutoInvalidate?: boolean,
	): Promise<any[] | undefined> {
		try {
			const cacheKey = this.keyPrefix + key;
			const cached = await redisClient.get(cacheKey);

			if (!cached) {
				return undefined;
			}

			const parsed = JSON.parse(cached);

			// If auto-invalidate is enabled, check if any associated tables have been modified
			if (isAutoInvalidate && tables.length > 0) {
				const lastModified = await this.getLastModified(tables);
				if (parsed.timestamp < lastModified) {
					await redisClient.del(cacheKey);
					return undefined;
				}
			}

			logger.debug(`Cache hit for key: ${key}`, { tables });
			return parsed.data;
		} catch (error) {
			logger.error(
				"Error getting from cache",
				error instanceof Error ? error : new Error(String(error)),
			);
			return undefined;
		}
	}

	async put(
		hashedQuery: string,
		response: any,
		tables: string[],
		isTag: boolean,
		config?: CacheConfig,
	): Promise<void> {
		try {
			const cacheKey = this.keyPrefix + hashedQuery;
			const ttl = config?.ex ?? this.defaultTtl;

			const cacheData = {
				data: response,
				timestamp: Date.now(),
				tables,
			};

			await redisClient.setex(cacheKey, ttl, JSON.stringify(cacheData));
			logger.debug(`Cached query result for key: ${hashedQuery}`, {
				tables,
				ttl,
			});
		} catch (error) {
			logger.error(
				"Error putting to cache",
				error instanceof Error ? error : new Error(String(error)),
			);
		}
	}

	async onMutate(params: MutationOption): Promise<void> {
		try {
			const tables = this.normalizeTables(params.tables);
			const tags = this.normalizeTags(params.tags);

			// Update last modified timestamp for affected tables
			if (tables.length > 0) {
				await this.updateLastModified(tables);
			}

			// Invalidate by tags if provided
			if (tags.length > 0) {
				await this.invalidateByTags(tags);
			}

			// Invalidate all cache entries related to these tables
			if (tables.length > 0) {
				await this.invalidateByTables(tables);
			}

			logger.debug("Cache invalidated on mutation", { tables, tags });
		} catch (error) {
			logger.error(
				"Error invalidating cache on mutation",
				error instanceof Error ? error : new Error(String(error)),
			);
		}
	}

	private normalizeTables(tables?: any): string[] {
		if (!tables) {
			return [];
		}

		if (typeof tables === "string") {
			return [tables];
		}
		if (Array.isArray(tables)) {
			return tables.map((table) =>
				typeof table === "string"
					? table
					: (table?.getSQL?.() ?? String(table)),
			);
		}

		return [
			typeof tables === "string"
				? tables
				: (tables?.getSQL?.() ?? String(tables)),
		];
	}

	private normalizeTags(tags?: string | string[]): string[] {
		if (!tags) {
			return [];
		}
		return Array.isArray(tags) ? tags : [tags];
	}

	private async getLastModified(tables: string[]): Promise<number> {
		try {
			const keys = tables.map((table) => this.tablePrefix + table);
			const timestamps = await redisClient.mget(...keys);

			let maxTimestamp = 0;
			for (const timestamp of timestamps) {
				if (timestamp) {
					maxTimestamp = Math.max(maxTimestamp, parseInt(timestamp, 10));
				}
			}

			return maxTimestamp;
		} catch (error) {
			logger.error(
				"Error getting last modified timestamps",
				error instanceof Error ? error : new Error(String(error)),
			);
			return Date.now(); // Return current time to force cache miss
		}
	}

	private async updateLastModified(tables: string[]): Promise<void> {
		try {
			const timestamp = Date.now().toString();
			const pipeline = redisClient.pipeline();

			for (const table of tables) {
				pipeline.set(this.tablePrefix + table, timestamp);
			}

			await pipeline.exec();
		} catch (error) {
			logger.error(
				"Error updating last modified timestamps",
				error instanceof Error ? error : new Error(String(error)),
			);
		}
	}

	private async invalidateByTags(tags: string[]): Promise<void> {
		try {
			// For tag-based invalidation, we'd need to maintain a mapping
			// of tags to cache keys. For now, we'll do a pattern-based deletion
			// which is less efficient but simpler to implement
			const pipeline = redisClient.pipeline();

			for (const tag of tags) {
				const pattern = `${this.keyPrefix}*:tag:${tag}`;
				const keys = await redisClient.keys(pattern);
				if (keys.length > 0) {
					pipeline.del(...keys);
				}
			}

			await pipeline.exec();
		} catch (error) {
			logger.error(
				"Error invalidating cache by tags",
				error instanceof Error ? error : new Error(String(error)),
			);
		}
	}

	private async invalidateByTables(tables: string[]): Promise<void> {
		try {
			// Get all cache keys and check which ones are associated with these tables
			const allKeys = await redisClient.keys(`${this.keyPrefix}*`);
			const keysToDelete: string[] = [];

			if (allKeys.length > 0) {
				const values = await redisClient.mget(...allKeys);

				for (let i = 0; i < allKeys.length; i++) {
					const value = values[i];
					if (value) {
						try {
							const parsed = JSON.parse(value);
							if (parsed.tables && Array.isArray(parsed.tables)) {
								const hasAffectedTable = parsed.tables.some((table: string) =>
									tables.includes(table),
								);
								if (hasAffectedTable) {
									keysToDelete.push(allKeys[i]);
								}
							}
						} catch {
							// Skip invalid JSON
						}
					}
				}
			}

			if (keysToDelete.length > 0) {
				await redisClient.del(...keysToDelete);
				logger.debug(`Invalidated ${keysToDelete.length} cache entries`, {
					tables,
				});
			}
		} catch (error) {
			logger.error(
				"Error invalidating cache by tables",
				error instanceof Error ? error : new Error(String(error)),
			);
		}
	}
}
