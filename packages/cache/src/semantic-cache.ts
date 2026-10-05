import crypto from "crypto";

import { logger } from "@llmgateway/logger";

import { storageRedisClient } from "./storage-redis.js";

/**
 * Entries kept per scope. A hit moves its entry back to the front, so the
 * prompts that actually repeat survive a burst of long-tail misses.
 */
export const SEMANTIC_CACHE_MAX_ENTRIES = 512;

/** How many live-response lookups a hit may make before giving up. */
const MAX_RESPONSE_PROBES = 5;

const NEGATIONS = new Set([
	"no",
	"not",
	"never",
	"none",
	"nothing",
	"dont",
	"don't",
	"doesnt",
	"doesn't",
	"cant",
	"can't",
	"cannot",
	"wont",
	"won't",
	"without",
	"isnt",
	"isn't",
	"arent",
	"aren't",
]);

/**
 * Tokens an embedding blurs but an answer hinges on: anything with a digit
 * (amounts, dates, "2+3"), all-caps codes (EUR, USD, TSLA) and negations.
 * Two prompts only match when their anchors agree in order, so "EUR to USD"
 * never replays "USD to EUR" and "2+3" never replays "2+4".
 */
export function semanticAnchors(text: string): string[] {
	const anchors: string[] = [];
	for (const raw of text.split(/\s+/)) {
		const token = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
		if (!token) {
			continue;
		}
		if (/\p{N}/u.test(token)) {
			anchors.push(token);
		} else if (/^[A-Z]{2,}$/.test(token)) {
			anchors.push(token);
		} else if (NEGATIONS.has(token.toLowerCase())) {
			anchors.push(token.toLowerCase());
		}
	}
	return anchors;
}

export interface SemanticCacheEntry {
	/** Response-cache key holding the cached completion. */
	cacheKey: string;
	embedding: number[];
	anchors: string[];
}

export interface SemanticCacheMatch {
	cacheKey: string;
	similarity: number;
}

interface StoredEntry extends SemanticCacheEntry {
	raw: string;
}

/**
 * Redis list key for one semantic scope. The scope hash covers everything in
 * the request except the embedded text (model, provider, sampling parameters,
 * the rest of the conversation), so a hit only ever replays a response
 * produced under identical settings.
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

function sameAnchors(a: string[], b: string[]): boolean {
	return a.length === b.length && a.every((token, i) => token === b[i]);
}

/** Entries with the same anchors at or above `threshold`, most similar first. */
export function rankSemanticMatches<T extends SemanticCacheEntry>(
	query: Pick<SemanticCacheEntry, "embedding" | "anchors">,
	entries: T[],
	threshold: number,
): (T & { similarity: number })[] {
	return entries
		.filter((entry) => sameAnchors(entry.anchors, query.anchors))
		.map((entry) => ({
			...entry,
			similarity: cosineSimilarity(query.embedding, entry.embedding),
		}))
		.filter((match) => match.similarity >= threshold)
		.sort((a, b) => b.similarity - a.similarity);
}

function encodeEntry(entry: SemanticCacheEntry): string {
	return JSON.stringify({
		k: entry.cacheKey,
		a: entry.anchors,
		e: Buffer.from(new Float32Array(entry.embedding).buffer).toString("base64"),
	});
}

/** Null for any malformed entry, so one bad element never disables the scope. */
export function decodeSemanticCacheEntry(
	raw: string,
): SemanticCacheEntry | null {
	let parsed: { k?: unknown; a?: unknown; e?: unknown };
	try {
		parsed = JSON.parse(raw) as { k?: unknown; a?: unknown; e?: unknown };
	} catch {
		return null;
	}
	if (
		!parsed ||
		typeof parsed.k !== "string" ||
		typeof parsed.e !== "string" ||
		!Array.isArray(parsed.a) ||
		!parsed.a.every((token) => typeof token === "string")
	) {
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
		anchors: parsed.a as string[],
		embedding: Array.from(new Float32Array(aligned.buffer)),
	};
}

async function readScope(scopeKey: string): Promise<StoredEntry[]> {
	const raw = await storageRedisClient.lrange(
		scopeKey,
		0,
		SEMANTIC_CACHE_MAX_ENTRIES - 1,
	);
	const entries: StoredEntry[] = [];
	for (const item of raw) {
		const entry = decodeSemanticCacheEntry(item);
		if (entry) {
			entries.push({ ...entry, raw: item });
		}
	}
	return entries;
}

export async function findSemanticCacheMatches(
	scopeKey: string,
	query: Pick<SemanticCacheEntry, "embedding" | "anchors">,
	threshold: number,
): Promise<SemanticCacheMatch[]> {
	try {
		return rankSemanticMatches(query, await readScope(scopeKey), threshold).map(
			({ cacheKey, similarity }) => ({ cacheKey, similarity }),
		);
	} catch (error) {
		logger.error("Error reading semantic cache", error as Error);
		return [];
	}
}

export interface SemanticCacheHit<T> extends SemanticCacheMatch {
	response: T;
}

/**
 * The most similar match whose cached response still exists, loaded with
 * `load`. An entry can outlive its response, because each new entry refreshes
 * the list's expiry, so a stale best match falls through to the next one. The
 * served entry moves to the front of the list so repeated prompts are not
 * evicted by one-off traffic.
 */
export async function findSemanticCacheHit<T>(
	scopeKey: string,
	query: Pick<SemanticCacheEntry, "embedding" | "anchors">,
	threshold: number,
	load: (cacheKey: string) => Promise<T | null>,
): Promise<SemanticCacheHit<T> | null> {
	let matches: (StoredEntry & { similarity: number })[];
	try {
		matches = rankSemanticMatches(query, await readScope(scopeKey), threshold);
	} catch (error) {
		logger.error("Error reading semantic cache", error as Error);
		return null;
	}
	for (const match of matches.slice(0, MAX_RESPONSE_PROBES)) {
		let response: T | null;
		try {
			response = await load(match.cacheKey);
		} catch (error) {
			logger.error("Error reading semantic cache response", error as Error);
			return null;
		}
		if (response === null || response === undefined) {
			continue;
		}
		void storageRedisClient
			.multi()
			.lrem(scopeKey, 0, match.raw)
			.lpush(scopeKey, match.raw)
			.exec()
			.catch((error: unknown) =>
				logger.error("Error refreshing semantic cache entry", error as Error),
			);
		return {
			cacheKey: match.cacheKey,
			similarity: match.similarity,
			response,
		};
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
