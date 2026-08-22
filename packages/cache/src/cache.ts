import crypto from "crypto";

import { logger } from "@llmgateway/logger";

import { storageRedisClient } from "./storage-redis.js";

/**
 * Generate a response-cache key scoped to a tenant.
 *
 * The scope (e.g. the project id) is a mandatory, server-derived key prefix:
 * the payload is built from the request body, so hashing it alone would let
 * any tenant replay another tenant's request bytes and collide on the same
 * Redis key, reading their cached LLM response (GHSA-h9ww-f95j-h54c).
 */
export function generateCacheKey(
	scope: string,
	payload: Record<string, any>,
): string {
	const hash = crypto
		.createHash("sha256")
		.update(JSON.stringify(payload))
		.digest("hex");
	return `${scope}:${hash}`;
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
		await storageRedisClient.set(
			key,
			JSON.stringify(value),
			"EX",
			expirationSeconds,
		);
	} catch (error) {
		logger.error("Error setting cache:", error as Error);
	}
}

export async function getCache(key: string): Promise<any | null> {
	try {
		const cachedValue = await storageRedisClient.get(key);
		if (!cachedValue) {
			return null;
		}
		return JSON.parse(cachedValue);
	} catch (error) {
		logger.error("Error getting cache:", error as Error);
		return null;
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
	scope: string,
	payload: Record<string, any>,
): string {
	return `stream:${generateCacheKey(scope, payload)}`;
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
		await storageRedisClient.set(
			key,
			JSON.stringify(data),
			"EX",
			expirationSeconds,
		);
	} catch (error) {
		logger.error("Error setting streaming cache:", error as Error);
	}
}

export async function getStreamingCache(
	key: string,
): Promise<StreamingCacheData | null> {
	try {
		const cachedValue = await storageRedisClient.get(key);
		if (!cachedValue) {
			return null;
		}
		return JSON.parse(cachedValue);
	} catch (error) {
		logger.error("Error getting streaming cache:", error as Error);
		return null;
	}
}
