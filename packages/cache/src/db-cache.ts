import { db, type InferSelectModel } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";

import { getCache, setCache } from "./cache.js";

import type { tables } from "@llmgateway/db";

/**
 * Cache duration for different types of database objects (in seconds)
 */
const CACHE_DURATIONS = {
	// Short-lived cache for authentication data
	apiKey: 300, // 5 minutes
	iamRules: 300, // 5 minutes
	userOrg: 300, // 5 minutes

	// Medium-lived cache for provider data
	providerKeys: 600, // 10 minutes

	// Longer-lived cache for static data (already handled in cache.ts)
	project: 60, // 1 minute
	organization: 60, // 1 minute
} as const;

/**
 * Wrapper for database operations with caching and fallback logic
 * If database is unavailable, returns cached data if available
 */
export class DatabaseCache {
	/**
	 * Get API key by token with caching and fallback
	 */
	static async getApiKey(
		token: string,
	): Promise<InferSelectModel<typeof tables.apiKey> | null> {
		const cacheKey = `api_key:${token}`;

		try {
			// Try to get from cache first
			const cached = await getCache(cacheKey);
			if (cached) {
				logger.debug(`API key found in cache: ${token.slice(0, 8)}...`);
				return cached;
			}

			// Try database if cache miss
			const apiKey = await db.query.apiKey.findFirst({
				where: {
					token: { eq: token },
				},
			});

			// Cache the result if found
			if (apiKey) {
				await setCache(cacheKey, apiKey, CACHE_DURATIONS.apiKey);
				logger.debug(`API key cached from database: ${token.slice(0, 8)}...`);
			}

			return apiKey || null;
		} catch (error) {
			logger.error(
				"Database error fetching API key, trying cache fallback:",
				error as Error,
			);

			// Fallback to cache even if expired
			const fallbackCached = await getCache(cacheKey);
			if (fallbackCached) {
				logger.warn(
					`Using cached API key as fallback: ${token.slice(0, 8)}...`,
				);
				return fallbackCached;
			}

			// If no cache available, throw error
			throw new Error("Database unavailable and no cached API key found");
		}
	}

	/**
	 * Get IAM rules for API key with caching and fallback
	 */
	static async getIamRules(
		apiKeyId: string,
	): Promise<InferSelectModel<typeof tables.apiKeyIamRule>[]> {
		const cacheKey = `iam_rules:${apiKeyId}`;

		try {
			// Try to get from cache first
			const cached = await getCache(cacheKey);
			if (cached) {
				logger.debug(`IAM rules found in cache: ${apiKeyId}`);
				return cached;
			}

			// Try database if cache miss
			const iamRules = await db.query.apiKeyIamRule.findMany({
				where: {
					apiKeyId: { eq: apiKeyId },
					status: { eq: "active" },
				},
			});

			// Always cache the result (even empty arrays)
			await setCache(cacheKey, iamRules, CACHE_DURATIONS.iamRules);
			logger.debug(`IAM rules cached from database: ${apiKeyId}`);

			return iamRules;
		} catch (error) {
			logger.error(
				"Database error fetching IAM rules, trying cache fallback:",
				error as Error,
			);

			// Fallback to cache even if expired
			const fallbackCached = await getCache(cacheKey);
			if (fallbackCached) {
				logger.warn(`Using cached IAM rules as fallback: ${apiKeyId}`);
				return fallbackCached;
			}

			// If no cache available, return empty array (fail-open for IAM)
			logger.warn(
				`No cached IAM rules found, defaulting to empty array (fail-open): ${apiKeyId}`,
			);
			return [];
		}
	}

	/**
	 * Get provider keys for organization with caching and fallback
	 */
	static async getProviderKeys(
		organizationId: string,
		provider?: string,
	): Promise<InferSelectModel<typeof tables.providerKey>[]> {
		const cacheKey = provider
			? `provider_keys:${organizationId}:${provider}`
			: `provider_keys:${organizationId}`;

		try {
			// Try to get from cache first
			const cached = await getCache(cacheKey);
			if (cached) {
				logger.debug(
					`Provider keys found in cache: ${organizationId}${provider ? `:${provider}` : ""}`,
				);
				return cached;
			}

			// Build query conditions
			const whereConditions: any = {
				status: { eq: "active" },
				organizationId: { eq: organizationId },
			};

			if (provider) {
				whereConditions.provider = { eq: provider };
			}

			// Try database if cache miss
			const providerKeys = await db.query.providerKey.findMany({
				where: whereConditions,
			});

			// Always cache the result
			await setCache(cacheKey, providerKeys, CACHE_DURATIONS.providerKeys);
			logger.debug(
				`Provider keys cached from database: ${organizationId}${provider ? `:${provider}` : ""}`,
			);

			return providerKeys;
		} catch (error) {
			logger.error(
				"Database error fetching provider keys, trying cache fallback:",
				error as Error,
			);

			// Fallback to cache even if expired
			const fallbackCached = await getCache(cacheKey);
			if (fallbackCached) {
				logger.warn(
					`Using cached provider keys as fallback: ${organizationId}${provider ? `:${provider}` : ""}`,
				);
				return fallbackCached;
			}

			// If no cache available, return empty array
			logger.warn(
				`No cached provider keys found, defaulting to empty array: ${organizationId}`,
			);
			return [];
		}
	}

	/**
	 * Get user from organization with caching and fallback
	 */
	static async getUserFromOrganization(organizationId: string): Promise<any> {
		const cacheKey = `user_org:${organizationId}`;

		try {
			// Try to get from cache first
			const cached = await getCache(cacheKey);
			if (cached) {
				logger.debug(`User organization found in cache: ${organizationId}`);
				return cached;
			}

			// Try database if cache miss
			const userOrg = await db.query.userOrganization.findFirst({
				where: {
					organizationId: { eq: organizationId },
				},
				with: {
					user: true,
				},
			});

			const result = userOrg?.user || null;

			// Cache the result
			await setCache(cacheKey, result, CACHE_DURATIONS.userOrg);
			logger.debug(`User organization cached from database: ${organizationId}`);

			return result;
		} catch (error) {
			logger.error(
				"Database error fetching user organization, trying cache fallback:",
				error as Error,
			);

			// Fallback to cache even if expired
			const fallbackCached = await getCache(cacheKey);
			if (fallbackCached) {
				logger.warn(
					`Using cached user organization as fallback: ${organizationId}`,
				);
				return fallbackCached;
			}

			// If no cache available, return null
			logger.warn(
				`No cached user organization found, defaulting to null: ${organizationId}`,
			);
			return null;
		}
	}

	/**
	 * Clear cache for specific keys (useful for invalidation)
	 */
	static async clearCache(keys: string[]): Promise<void> {
		try {
			for (const key of keys) {
				await setCache(key, null, 0); // Setting with 0 expiry effectively deletes
			}
		} catch (error) {
			logger.error("Error clearing cache:", error as Error);
		}
	}
}
