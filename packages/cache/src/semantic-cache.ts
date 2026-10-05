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

/** Entries at or above `threshold`, most similar first. */
export function rankSemanticMatches(
	embedding: number[],
	entries: SemanticCacheEntry[],
	threshold: number,
): SemanticCacheMatch[] {
	return entries
		.map((entry) => ({
			cacheKey: entry.cacheKey,
			similarity: cosineSimilarity(embedding, entry.embedding),
		}))
		.filter((match) => match.similarity >= threshold)
		.sort((a, b) => b.similarity - a.similarity);
}

function encodeEntry(entry: SemanticCacheEntry): string {
	return JSON.stringify({
		k: entry.cacheKey,
		e: Buffer.from(new Float32Array(entry.embedding).buffer).toString("base64"),
	});
}

/** Null for any malformed entry, so one bad element never disables the scope. */
export function decodeSemanticCacheEntry(
	raw: string,
): SemanticCacheEntry | null {
	let parsed: { k?: unknown; e?: unknown };
	try {
		parsed = JSON.parse(raw) as { k?: unknown; e?: unknown };
	} catch {
		return null;
	}
	if (!parsed || typeof parsed.k !== "string" || typeof parsed.e !== "string") {
		return null;
	}
	const bytes = Buffer.from(parsed.e, "base64");
	if (
		bytes.byteLength === 0 ||
		bytes.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0
	) {
		return null;
	}
	// Copy into a fresh, aligned buffer: pooled Buffers can start at an offset
	// that is not a multiple of 4.
	const aligned = new Uint8Array(bytes.byteLength);
	aligned.set(bytes);
	return {
		cacheKey: parsed.k,
		embedding: Array.from(new Float32Array(aligned.buffer)),
	};
}

export async function findSemanticCacheMatches(
	scopeKey: string,
	embedding: number[],
	threshold: number,
): Promise<SemanticCacheMatch[]> {
	try {
		const raw = await storageRedisClient.lrange(
			scopeKey,
			0,
			SEMANTIC_CACHE_MAX_ENTRIES - 1,
		);
		const entries = raw
			.map(decodeSemanticCacheEntry)
			.filter((entry): entry is SemanticCacheEntry => entry !== null);
		return rankSemanticMatches(embedding, entries, threshold);
	} catch (error) {
		logger.error("Error reading semantic cache", error as Error);
		return [];
	}
}

/**
 * The most similar match whose cached response still exists, with that
 * response. An entry can outlive its response, because each new entry
 * refreshes the list's expiry, so a stale best match falls through to the
 * next one.
 */
export async function findSemanticCacheHit(
	scopeKey: string,
	embedding: number[],
	threshold: number,
): Promise<(SemanticCacheMatch & { response: unknown }) | null> {
	const matches = await findSemanticCacheMatches(
		scopeKey,
		embedding,
		threshold,
	);
	if (matches.length === 0) {
		return null;
	}
	try {
		const values = await storageRedisClient.mget(
			matches.map((match) => match.cacheKey),
		);
		for (let i = 0; i < matches.length; i++) {
			const value = values[i];
			if (value) {
				return { ...matches[i], response: JSON.parse(value) };
			}
		}
	} catch (error) {
		logger.error("Error reading semantic cache responses", error as Error);
	}
	return null;
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
