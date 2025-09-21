import crypto from "crypto";

import { logger } from "@llmgateway/logger";

import { redisClient } from "./redis.js";

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
