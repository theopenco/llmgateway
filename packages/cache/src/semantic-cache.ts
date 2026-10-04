import crypto from "crypto";

import { logger } from "@llmgateway/logger";

import { storageRedisClient } from "./storage-redis.js";

/** Newest entries kept per scope; older ones fall off the list. */
export const SEMANTIC_CACHE_MAX_ENTRIES = 256;

export interface SemanticCacheEntry {
	/** Response-cache key holding the cached completion. */
	cacheKey: string;
	embedding: number[];
}

export interface SemanticCacheMatch {
	cacheKey: string;
	similarity: number;
}

/**
 * Redis list key for one semantic scope. The scope hash covers everything in
 * the request except the messages (model, provider, sampling parameters), so
 * a hit only ever replays a response produced under identical settings.
 */
export function generateSemanticCacheScopeKey(
	projectId: string,
	scope: Record<string, unknown>,
): string {
	const hash = crypto
		.createHash("sha256")
		.update(JSON.stringify(scope))
		.digest("hex");
	return `semcache:${projectId}:${hash}`;
}

export function cosineSimilarity(a: number[], b: number[]): number {
	if (a.length === 0 || a.length !== b.length) {
		return 0;
	}
	let dot = 0;
	let normA = 0;
	let normB = 0;
	for (let i = 0; i < a.length; i++) {
		dot += a[i] * b[i];
		normA += a[i] * a[i];
		normB += b[i] * b[i];
	}
	if (normA === 0 || normB === 0) {
		return 0;
	}
	return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** The most similar entry at or above `threshold`, or null. */
export function findBestSemanticMatch(
	embedding: number[],
	entries: SemanticCacheEntry[],
	threshold: number,
): SemanticCacheMatch | null {
	let best: SemanticCacheMatch | null = null;
	for (const entry of entries) {
		const similarity = cosineSimilarity(embedding, entry.embedding);
		if (similarity >= threshold && (!best || similarity > best.similarity)) {
			best = { cacheKey: entry.cacheKey, similarity };
		}
	}
	return best;
}

function encodeEntry(entry: SemanticCacheEntry): string {
	return JSON.stringify({
		k: entry.cacheKey,
		e: Buffer.from(new Float32Array(entry.embedding).buffer).toString("base64"),
	});
}

function decodeEntry(raw: string): SemanticCacheEntry | null {
	const parsed = JSON.parse(raw) as { k?: unknown; e?: unknown };
	if (typeof parsed.k !== "string" || typeof parsed.e !== "string") {
		return null;
	}
	const bytes = Buffer.from(parsed.e, "base64");
	const floats = new Float32Array(
		bytes.buffer,
		bytes.byteOffset,
		bytes.byteLength / Float32Array.BYTES_PER_ELEMENT,
	);
	return { cacheKey: parsed.k, embedding: Array.from(floats) };
}

export async function findSemanticCacheMatch(
	scopeKey: string,
	embedding: number[],
	threshold: number,
): Promise<SemanticCacheMatch | null> {
	try {
		const raw = await storageRedisClient.lrange(
			scopeKey,
			0,
			SEMANTIC_CACHE_MAX_ENTRIES - 1,
		);
		const entries = raw
			.map(decodeEntry)
			.filter((entry): entry is SemanticCacheEntry => entry !== null);
		return findBestSemanticMatch(embedding, entries, threshold);
	} catch (error) {
		logger.error("Error reading semantic cache", error as Error);
		return null;
	}
}

export async function addSemanticCacheEntry(
	scopeKey: string,
	entry: SemanticCacheEntry,
	expirationSeconds: number,
): Promise<void> {
	try {
		await storageRedisClient
			.multi()
			.lpush(scopeKey, encodeEntry(entry))
			.ltrim(scopeKey, 0, SEMANTIC_CACHE_MAX_ENTRIES - 1)
			.expire(scopeKey, expirationSeconds)
			.exec();
	} catch (error) {
		logger.error("Error writing semantic cache", error as Error);
	}
}
