import { db, type InferSelectModel } from "@llmgateway/db";
import crypto from "crypto";

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
		console.error("Error setting cache:", error);
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
		console.error("Error getting cache:", error);
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
		console.error("Error checking if caching is enabled:", error);
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
		console.error("Error fetching project:", error);
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
		console.error("Error fetching organization:", error);
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
		console.error("Error fetching provider key:", error);
		throw error;
	}
}
