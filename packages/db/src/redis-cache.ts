import { Cache, type MutationOption } from "drizzle-orm/cache/core";

import { logger } from "@llmgateway/logger";

import type { Redis } from "ioredis";

interface CacheConfig {
	ex?: number;
	px?: number;
	exat?: number;
	pxat?: number;
	keepTtl?: boolean;
	hexOptions?: "NX" | "nx" | "XX" | "xx" | "GT" | "gt" | "LT" | "lt";
	tags?: string[]; // Tags for cache invalidation
}

export class RedisCache extends Cache {
	private readonly redisClient: Redis;
	private readonly keyPrefix = "drizzle:cache:";
	private readonly tablePrefix = "drizzle:tables:";
	private readonly tagPrefix = "drizzle:tags:";
	private readonly tableKeysPrefix = "drizzle:table_keys:";
	private readonly defaultTtl = 60; // 1 minute in seconds
	private readonly batchSize = 500; // Max keys to process in one batch

	public constructor(redisClient: Redis) {
		super();
		this.redisClient = redisClient;
	}

	public strategy(): "all" {
		return "all";
	}

	public async get(
		key: string,
		tables: string[],
		isTag: boolean,
		isAutoInvalidate?: boolean,
	): Promise<any[] | undefined> {
		try {
			const cacheKey = this.keyPrefix + key;
			const cached = await this.redisClient.get(cacheKey);

			if (!cached) {
				return undefined;
			}

			const parsed = JSON.parse(cached);

			// If auto-invalidate is enabled, check if any associated tables have been modified
			if (isAutoInvalidate && tables.length > 0) {
				const lastModified = await this.getLastModified(tables);
				if (parsed.timestamp < lastModified) {
					await this.redisClient.del(cacheKey);
					return undefined;
				}
			}

			logger.trace(`Cache hit for key: ${key}`, { tables });
			return parsed.data;
		} catch (error) {
			logger.error(
				"Error getting from cache",
				error instanceof Error ? error : new Error(String(error)),
			);
			return undefined;
		}
	}

	public async put(
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

			// Use pipeline to set cache data and update indices atomically
			const pipeline = this.redisClient.pipeline();

			// Set the cache entry
			pipeline.setex(cacheKey, ttl, JSON.stringify(cacheData));

			// Add cache key to table index sets
			for (const table of tables) {
				const tableKeysSet = this.tableKeysPrefix + table;
				pipeline.sadd(tableKeysSet, cacheKey);
				// Set expiry on the table index set (slightly longer than cache entries)
				pipeline.expire(tableKeysSet, ttl + 60);
			}

			// Handle tag indexing - either from config.tags or legacy isTag parameter
			if (config?.tags && config.tags.length > 0) {
				// Modern approach: use tags from config
				for (const tag of config.tags) {
					const tagKeysSet = this.tagPrefix + tag;
					pipeline.sadd(tagKeysSet, cacheKey);
					pipeline.expire(tagKeysSet, ttl + 60);
				}
			} else if (isTag) {
				// Legacy approach: treat the hashedQuery as a tag
				const tagKeysSet = this.tagPrefix + hashedQuery;
				pipeline.sadd(tagKeysSet, cacheKey);
				pipeline.expire(tagKeysSet, ttl + 60);
			}

			await pipeline.exec();
			logger.trace(`Cached query result for key: ${hashedQuery}`, {
				tables,
				tags: config?.tags,
				isTag,
				ttl,
			});
		} catch (error) {
			logger.error(
				"Error putting to cache",
				error instanceof Error ? error : new Error(String(error)),
			);
		}
	}

	public async onMutate(params: MutationOption): Promise<void> {
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

			logger.trace("Cache invalidated on mutation", { tables, tags });
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
			const timestamps = await this.redisClient.mget(...keys);

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
			const pipeline = this.redisClient.pipeline();

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
			const allKeysToDelete = new Set<string>();

			// Collect keys from tag sets
			for (const tag of tags) {
				const tagKeysSet = this.tagPrefix + tag;
				const tagKeys = await this.redisClient.smembers(tagKeysSet);
				for (const key of tagKeys) {
					allKeysToDelete.add(key);
				}
			}

			// Delete keys in batches
			if (allKeysToDelete.size > 0) {
				await this.deleteKeysInBatches(Array.from(allKeysToDelete));

				// Clean up tag sets
				const pipeline = this.redisClient.pipeline();
				for (const tag of tags) {
					pipeline.del(this.tagPrefix + tag);
				}
				await pipeline.exec();
			}
		} catch (error) {
			logger.error(
				"Error invalidating cache by tags",
				error instanceof Error ? error : new Error(String(error)),
			);
		}
	}

	private async invalidateByTables(tables: string[]): Promise<void> {
		try {
			const allKeysToDelete = new Set<string>();

			// Collect keys from table index sets
			for (const table of tables) {
				const tableKeysSet = this.tableKeysPrefix + table;
				const tableKeys = await this.redisClient.smembers(tableKeysSet);
				for (const key of tableKeys) {
					allKeysToDelete.add(key);
				}
			}

			// Delete keys in batches and clean up table indices
			if (allKeysToDelete.size > 0) {
				const keysArray = Array.from(allKeysToDelete);
				await this.deleteKeysInBatches(keysArray);

				// Remove keys from table index sets
				const pipeline = this.redisClient.pipeline();
				for (const table of tables) {
					const tableKeysSet = this.tableKeysPrefix + table;
					// Remove invalidated keys from the set
					for (const key of keysArray) {
						pipeline.srem(tableKeysSet, key);
					}
				}
				await pipeline.exec();

				logger.trace(`Invalidated ${keysArray.length} cache entries`, {
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

	private async deleteKeysInBatches(keys: string[]): Promise<void> {
		try {
			for (let i = 0; i < keys.length; i += this.batchSize) {
				const batch = keys.slice(i, i + this.batchSize);
				if (batch.length > 0) {
					await this.redisClient.unlink(...batch);
				}
			}
		} catch (error) {
			logger.error(
				"Error deleting keys in batches",
				error instanceof Error ? error : new Error(String(error)),
			);
		}
	}
}
