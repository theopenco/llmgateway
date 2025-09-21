import crypto from "crypto";

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { logger } from "@llmgateway/logger";

import { relations } from "./relations.js";

// Simple cache implementation that wraps query results
class SimpleQueryCache {
	public constructor(
		private redisClient: any,
		private expirationSeconds = 60,
		private keyPrefix = "query_cache",
	) {}

	private generateKey(queryId: string, params?: unknown[]): string {
		const fullQuery = JSON.stringify({ queryId, params });
		const hash = crypto.createHash("sha256").update(fullQuery).digest("hex");
		return `${this.keyPrefix}:${hash}`;
	}

	public async get(queryId: string, params?: unknown[]): Promise<any | null> {
		if (process.env.NODE_ENV === "test") {
			return null;
		}

		try {
			const key = this.generateKey(queryId, params);
			const cached = await this.redisClient.get(key);

			if (cached) {
				logger.debug(`Cache hit for query: ${queryId}`);
				return JSON.parse(cached);
			}

			return null;
		} catch (error) {
			logger.error("Error getting from cache:", error as Error);
			return null;
		}
	}

	public async set(
		queryId: string,
		params: unknown[] | undefined,
		result: any,
	): Promise<void> {
		if (process.env.NODE_ENV === "test") {
			return;
		}

		try {
			const key = this.generateKey(queryId, params);
			await this.redisClient.setex(
				key,
				this.expirationSeconds,
				JSON.stringify(result),
			);
			logger.debug(`Cached result for query: ${queryId}`);
		} catch (error) {
			logger.error("Error setting cache:", error as Error);
		}
	}
}

// Create cached database instance factory
export function createCachedDb(redisClient: any) {
	const pool = new Pool({
		connectionString:
			process.env.DATABASE_URL || "postgres://postgres:pw@localhost:5432/db",
	});

	const db = drizzle({
		client: pool,
		casing: "snake_case",
		relations,
	});

	const cache = new SimpleQueryCache(redisClient);

	const closeDatabase = async (): Promise<void> => {
		try {
			await pool.end();
			logger.info("Database connection pool closed");
		} catch (error) {
			logger.error(
				"Error closing database connection pool",
				error instanceof Error ? error : new Error(String(error)),
			);
			throw error;
		}
	};

	return { db, closeDatabase, cache };
}

// Individual query functions that can be used with the cached db
export function createDbQueries(
	db: ReturnType<typeof drizzle>,
	cache: SimpleQueryCache,
) {
	return {
		async getProject(projectId: string): Promise<any> {
			try {
				// Check cache first
				const cached = await cache.get("getProject", [projectId]);
				if (cached) {
					return cached;
				}

				const project = await db.query.project.findFirst({
					where: (project, { eq }) => eq(project.id, projectId),
				});

				// Cache the result
				if (project) {
					await cache.set("getProject", [projectId], project);
				}

				return project;
			} catch (error) {
				logger.error("Error fetching project:", error as Error);
				throw error;
			}
		},

		async getOrganization(organizationId: string): Promise<any> {
			try {
				// Check cache first
				const cached = await cache.get("getOrganization", [organizationId]);
				if (cached) {
					return cached;
				}

				const organization = await db.query.organization.findFirst({
					where: (organization, { eq }) => eq(organization.id, organizationId),
				});

				// Cache the result
				if (organization) {
					await cache.set("getOrganization", [organizationId], organization);
				}

				return organization;
			} catch (error) {
				logger.error("Error fetching organization:", error as Error);
				throw error;
			}
		},

		async getProviderKey(
			organizationId: string,
			provider: string,
		): Promise<any> {
			try {
				// Check cache first
				const cached = await cache.get("getProviderKey", [
					organizationId,
					provider,
				]);
				if (cached) {
					return cached;
				}

				const providerKey = await db.query.providerKey.findFirst({
					where: (providerKey, { eq, and }) =>
						and(
							eq(providerKey.status, "active"),
							eq(providerKey.organizationId, organizationId),
							eq(providerKey.provider, provider),
						),
				});

				// Cache the result
				if (providerKey) {
					await cache.set(
						"getProviderKey",
						[organizationId, provider],
						providerKey,
					);
				}

				return providerKey;
			} catch (error) {
				logger.error("Error fetching provider key:", error as Error);
				throw error;
			}
		},

		async getCustomProviderKey(
			organizationId: string,
			customName: string,
		): Promise<any> {
			try {
				// Check cache first
				const cached = await cache.get("getCustomProviderKey", [
					organizationId,
					customName,
				]);
				if (cached) {
					return cached;
				}

				const providerKey = await db.query.providerKey.findFirst({
					where: (providerKey, { eq, and }) =>
						and(
							eq(providerKey.status, "active"),
							eq(providerKey.organizationId, organizationId),
							eq(providerKey.provider, "custom"),
							eq(providerKey.name, customName),
						),
				});

				// Cache the result
				if (providerKey) {
					await cache.set(
						"getCustomProviderKey",
						[organizationId, customName],
						providerKey,
					);
				}

				return providerKey;
			} catch (error) {
				logger.error("Error fetching custom provider key:", error as Error);
				throw error;
			}
		},

		async checkCustomProviderExists(
			organizationId: string,
			providerCandidate: string,
		): Promise<boolean> {
			try {
				// Check cache first
				const cached = await cache.get("checkCustomProviderExists", [
					organizationId,
					providerCandidate,
				]);
				if (cached !== null) {
					return cached;
				}

				const providerKey = await db.query.providerKey.findFirst({
					where: (providerKey, { eq, and }) =>
						and(
							eq(providerKey.status, "active"),
							eq(providerKey.organizationId, organizationId),
							eq(providerKey.provider, "custom"),
							eq(providerKey.name, providerCandidate),
						),
				});

				const exists = !!providerKey;

				// Cache the result
				await cache.set(
					"checkCustomProviderExists",
					[organizationId, providerCandidate],
					exists,
				);

				return exists;
			} catch (error) {
				logger.error(
					"Error checking if custom provider exists:",
					error as Error,
				);
				throw error;
			}
		},

		async isCachingEnabled(
			projectId: string,
		): Promise<{ enabled: boolean; duration: number }> {
			try {
				// Check cache first
				const cached = await cache.get("isCachingEnabled", [projectId]);
				if (cached) {
					return cached;
				}

				const project = await db.query.project.findFirst({
					where: (project, { eq }) => eq(project.id, projectId),
				});

				const result = {
					enabled: project?.cachingEnabled || false,
					duration: project?.cacheDurationSeconds || 60,
				};

				// Always cache this result (even if project is null)
				await cache.set("isCachingEnabled", [projectId], result);

				return result;
			} catch (error) {
				logger.error("Error checking if caching is enabled:", error as Error);
				throw error;
			}
		},
	};
}
