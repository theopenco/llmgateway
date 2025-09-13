import crypto from "crypto";

import { db, type InferSelectModel } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";

import redisClient from "./redis";

import type { tables } from "@llmgateway/db";

export function generateCacheKey(payload: Record<string, any>): string {
	return crypto
		.createHash("sha256")
		.update(JSON.stringify(payload))
		.digest("hex");
}

export async function setCache(
	key: string,
	value: any,
	expirationSeconds: number,
): Promise<void> {
	if (process.env.NODE_ENV === "test") {
		// temp disable caching in test mode
		return;
	}

	try {
		await redisClient.set(key, JSON.stringify(value), "EX", expirationSeconds);
	} catch (error) {
		logger.error("Error setting cache:", error as Error);
	}
}

export async function getCache(key: string): Promise<any | null> {
	try {
		const cachedValue = await redisClient.get(key);
		if (!cachedValue) {
			return null;
		}
		return JSON.parse(cachedValue);
	} catch (error) {
		logger.error("Error getting cache:", error as Error);
		return null;
	}
}

export async function isCachingEnabled(
	projectId: string,
): Promise<{ enabled: boolean; duration: number }> {
	try {
		const configCacheKey = `project_cache_config:${projectId}`;
		const cachedConfig = await redisClient.get(configCacheKey);

		if (cachedConfig) {
			return JSON.parse(cachedConfig);
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

		await redisClient.set(configCacheKey, JSON.stringify(config), "EX", 300);

		return config;
	} catch (error) {
		logger.error("Error checking if caching is enabled:", error as Error);
		throw error;
	}
}

export async function getProject(projectId: string): Promise<any> {
	try {
		const projectCacheKey = `project:${projectId}`;
		const cachedProject = await getCache(projectCacheKey);

		if (cachedProject) {
			return cachedProject;
		}

		const project = await db.query.project.findFirst({
			where: {
				id: {
					eq: projectId,
				},
			},
		});

		if (project) {
			await setCache(projectCacheKey, project, 60);
		}

		return project;
	} catch (error) {
		logger.error("Error fetching project:", error as Error);
		throw error;
	}
}

export async function getOrganization(organizationId: string): Promise<any> {
	try {
		const orgCacheKey = `organization:${organizationId}`;
		const cachedOrg = await getCache(orgCacheKey);

		if (cachedOrg) {
			return cachedOrg;
		}

		const organization = await db.query.organization.findFirst({
			where: {
				id: {
					eq: organizationId,
				},
			},
		});

		if (organization) {
			await setCache(orgCacheKey, organization, 60);
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
): Promise<InferSelectModel<typeof tables.providerKey> | undefined> {
	try {
		const providerKeyCacheKey = `provider_key:${organizationId}:${provider}`;
		const cachedProviderKey = await getCache(providerKeyCacheKey);

		if (cachedProviderKey) {
			return cachedProviderKey;
		}

		const providerKey = await db.query.providerKey.findFirst({
			where: {
				status: {
					eq: "active",
				},
				organizationId: {
					eq: organizationId,
				},
				provider: {
					eq: provider,
				},
			},
		});

		if (providerKey) {
			await setCache(providerKeyCacheKey, providerKey, 60);
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
): Promise<InferSelectModel<typeof tables.providerKey> | undefined> {
	try {
		const providerKeyCacheKey = `custom_provider_key:${organizationId}:${customName}`;
		const cachedProviderKey = await getCache(providerKeyCacheKey);

		if (cachedProviderKey) {
			return cachedProviderKey;
		}

		const providerKey = await db.query.providerKey.findFirst({
			where: {
				status: {
					eq: "active",
				},
				organizationId: {
					eq: organizationId,
				},
				provider: {
					eq: "custom",
				},
				name: {
					eq: customName,
				},
			},
		});

		if (providerKey) {
			await setCache(providerKeyCacheKey, providerKey, 60);
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
		const existsCacheKey = `custom_provider_exists:${organizationId}:${providerCandidate}`;
		const cachedResult = await getCache(existsCacheKey);

		if (cachedResult !== null) {
			return cachedResult;
		}

		const providerKey = await db.query.providerKey.findFirst({
			where: {
				status: {
					eq: "active",
				},
				organizationId: {
					eq: organizationId,
				},
				provider: {
					eq: "custom",
				},
				name: {
					eq: providerCandidate,
				},
			},
		});

		const exists = !!providerKey;
		await setCache(existsCacheKey, exists, 60);

		return exists;
	} catch (error) {
		logger.error("Error checking if custom provider exists:", error as Error);
		throw error;
	}
}

// Streaming cache data structure
interface StreamingCacheChunk {
	data: string;
	eventId: number;
	event?: string;
	timestamp: number;
}

interface StreamingCacheData {
	chunks: StreamingCacheChunk[];
	metadata: {
		model: string;
		provider: string;
		finishReason: string | null;
		totalChunks: number;
		duration: number;
		completed: boolean;
	};
}

export function generateStreamingCacheKey(
	payload: Record<string, any>,
): string {
	return `stream:${generateCacheKey(payload)}`;
}

export async function setStreamingCache(
	key: string,
	data: StreamingCacheData,
	expirationSeconds: number,
): Promise<void> {
	if (process.env.NODE_ENV === "test") {
		// temp disable caching in test mode
		return;
	}

	try {
		await redisClient.set(key, JSON.stringify(data), "EX", expirationSeconds);
	} catch (error) {
		logger.error("Error setting streaming cache:", error as Error);
	}
}

export async function getStreamingCache(
	key: string,
): Promise<StreamingCacheData | null> {
	try {
		const cachedValue = await redisClient.get(key);
		if (!cachedValue) {
			return null;
		}
		return JSON.parse(cachedValue);
	} catch (error) {
		logger.error("Error getting streaming cache:", error as Error);
		return null;
	}
}
