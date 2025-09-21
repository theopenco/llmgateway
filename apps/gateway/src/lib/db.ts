import crypto from "crypto";

import { redisClient } from "@llmgateway/cache";
import { db as baseDb } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";

// Import the base db to use for actual queries

// Re-export everything from @llmgateway/db
export * from "@llmgateway/db";

// Simple cache wrapper
class QueryCache {
	private keyPrefix = "gateway_cache";
	private expirationSeconds = 60;

	private generateKey(queryId: string, params?: unknown[]): string {
		const fullQuery = JSON.stringify({ queryId, params });
		const hash = crypto.createHash("sha256").update(fullQuery).digest("hex");
		return `${this.keyPrefix}:${hash}`;
	}

	async get(queryId: string, params?: unknown[]): Promise<any | null> {
		if (process.env.NODE_ENV === "test") {
			return null;
		}

		try {
			const key = this.generateKey(queryId, params);
			const cached = await redisClient.get(key);
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

	async set(
		queryId: string,
		params: unknown[] | undefined,
		result: any,
	): Promise<void> {
		if (process.env.NODE_ENV === "test") {
			return;
		}

		try {
			const key = this.generateKey(queryId, params);
			await redisClient.setex(
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

const cache = new QueryCache();

// Export the base db instance
export const db = baseDb;

// Cached query functions
export async function getProject(projectId: string): Promise<any> {
	try {
		const cached = await cache.get("getProject", [projectId]);
		if (cached) {
			return cached;
		}

		const project = await baseDb.query.project.findFirst({
			where: (project, { eq }) => eq(project.id, projectId),
		});

		if (project) {
			await cache.set("getProject", [projectId], project);
		}

		return project;
	} catch (error) {
		logger.error("Error fetching project:", error as Error);
		throw error;
	}
}

export async function getOrganization(organizationId: string): Promise<any> {
	try {
		const cached = await cache.get("getOrganization", [organizationId]);
		if (cached) {
			return cached;
		}

		const organization = await baseDb.query.organization.findFirst({
			where: (organization, { eq }) => eq(organization.id, organizationId),
		});

		if (organization) {
			await cache.set("getOrganization", [organizationId], organization);
		}

		return organization;
	} catch (error) {
		logger.error("Error fetching organization:", error as Error);
		throw error;
	}
}

export async function getProviderKey(
	organizationId: string,
	provider: string,
): Promise<any> {
	try {
		const cached = await cache.get("getProviderKey", [
			organizationId,
			provider,
		]);
		if (cached) {
			return cached;
		}

		const providerKey = await baseDb.query.providerKey.findFirst({
			where: (providerKey, { eq, and }) =>
				and(
					eq(providerKey.status, "active"),
					eq(providerKey.organizationId, organizationId),
					eq(providerKey.provider, provider),
				),
		});

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
}

export async function getCustomProviderKey(
	organizationId: string,
	customName: string,
): Promise<any> {
	try {
		const cached = await cache.get("getCustomProviderKey", [
			organizationId,
			customName,
		]);
		if (cached) {
			return cached;
		}

		const providerKey = await baseDb.query.providerKey.findFirst({
			where: (providerKey, { eq, and }) =>
				and(
					eq(providerKey.status, "active"),
					eq(providerKey.organizationId, organizationId),
					eq(providerKey.provider, "custom"),
					eq(providerKey.name, customName),
				),
		});

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
}

export async function checkCustomProviderExists(
	organizationId: string,
	providerCandidate: string,
): Promise<boolean> {
	try {
		const cached = await cache.get("checkCustomProviderExists", [
			organizationId,
			providerCandidate,
		]);
		if (cached !== null) {
			return cached;
		}

		const providerKey = await baseDb.query.providerKey.findFirst({
			where: (providerKey, { eq, and }) =>
				and(
					eq(providerKey.status, "active"),
					eq(providerKey.organizationId, organizationId),
					eq(providerKey.provider, "custom"),
					eq(providerKey.name, providerCandidate),
				),
		});

		const exists = !!providerKey;
		await cache.set(
			"checkCustomProviderExists",
			[organizationId, providerCandidate],
			exists,
		);

		return exists;
	} catch (error) {
		logger.error("Error checking if custom provider exists:", error as Error);
		throw error;
	}
}

export async function isCachingEnabled(
	projectId: string,
): Promise<{ enabled: boolean; duration: number }> {
	try {
		const cached = await cache.get("isCachingEnabled", [projectId]);
		if (cached) {
			return cached;
		}

		const project = await baseDb.query.project.findFirst({
			where: (project, { eq }) => eq(project.id, projectId),
		});

		const result = {
			enabled: project?.cachingEnabled || false,
			duration: project?.cacheDurationSeconds || 60,
		};

		await cache.set("isCachingEnabled", [projectId], result);

		return result;
	} catch (error) {
		logger.error("Error checking if caching is enabled:", error as Error);
		throw error;
	}
}
