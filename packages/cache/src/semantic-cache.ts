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
	"nobody",
	"nowhere",
	"neither",
	"nor",
	"cannot",
	"without",
]);

/**
 * Words whose swap flips the answer while the sentence stays almost
 * identical, so an embedding scores the pair above any usable threshold:
 * "sell Tesla" and "buy Tesla", "approve" and "reject". Matched on the base
 * form, so "selling" and "sold" count as "sell".
 */
const POLAR_WORDS = new Set([
	"buy",
	"sell",
	"sold",
	"bought",
	"approve",
	"reject",
	"deny",
	"confirm",
	"cancel",
	"accept",
	"decline",
	"enable",
	"disable",
	"add",
	"remove",
	"delete",
	"create",
	"destroy",
	"start",
	"stop",
	"pause",
	"resume",
	"open",
	"close",
	"increase",
	"decrease",
	"raise",
	"lower",
	"allow",
	"block",
	"grant",
	"revoke",
	"lock",
	"unlock",
	"include",
	"exclude",
	"enter",
	"exit",
	"import",
	"export",
	"upload",
	"download",
	"send",
	"receive",
	"give",
	"take",
	"win",
	"lose",
	"pass",
	"fail",
	"subscribe",
	"unsubscribe",
	"activate",
	"deactivate",
	"on",
	"off",
	"up",
	"down",
	"more",
	"less",
	"most",
	"least",
	"max",
	"min",
	"maximum",
	"minimum",
	"higher",
	"highest",
	"lowest",
	"above",
	"below",
	"before",
	"after",
	"first",
	"last",
	"earliest",
	"latest",
	"oldest",
	"newest",
	"true",
	"false",
	"yes",
	"always",
	"left",
	"right",
	"long",
	"short",
	"ascending",
	"descending",
]);

const IRREGULAR_POLAR: Record<string, string> = {
	sold: "sell",
	bought: "buy",
	won: "win",
	lost: "lose",
	gave: "give",
	given: "give",
	took: "take",
	taken: "take",
	sent: "send",
	ran: "run",
};

/** Base form of a polar word, or null when the word is not one. */
function polarBase(word: string): string | null {
	const lower = word.toLowerCase();
	if (IRREGULAR_POLAR[lower]) {
		return IRREGULAR_POLAR[lower];
	}
	const candidates = [lower];
	for (const suffix of ["ing", "ed", "es", "s", "d"]) {
		if (lower.length > suffix.length + 2 && lower.endsWith(suffix)) {
			const stem = lower.slice(0, -suffix.length);
			candidates.push(stem, `${stem}e`);
			// "cancelled" -> "cancell" -> "cancel"
			if (stem.length > 2 && stem[stem.length - 1] === stem[stem.length - 2]) {
				candidates.push(stem.slice(0, -1));
			}
		}
	}
	return candidates.find((candidate) => POLAR_WORDS.has(candidate)) ?? null;
}

/**
 * Tokens an embedding blurs but an answer hinges on, in order of appearance:
 *
 * - anything with a digit (amounts, dates, "2+3"), kept whole;
 * - all-caps codes (EUR, USD, TSLA), even when joined by punctuation
 *   ("EUR→USD", "EUR/USD");
 * - negations, including every "n't" contraction, normalised to "not";
 * - polar words whose swap flips the meaning (buy/sell, approve/reject);
 * - capitalised names after the first word of a sentence (Paris, Tesla).
 *
 * Two prompts only match when their anchors agree in order, so "EUR to USD"
 * never replays "USD to EUR", "2+3" never replays "2+4", "sell Tesla" never
 * replays "buy Tesla" and "didn't receive" never replays "received".
 */
export function semanticAnchors(text: string): string[] {
	const anchors: string[] = [];
	let sentenceStart = true;
	for (const raw of text.split(/\s+/)) {
		if (!raw) {
			continue;
		}
		const word = raw
			.replace(/[\u2018\u2019\u02bc]/g, "'")
			.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
		const atSentenceStart = sentenceStart;
		sentenceStart = /[.!?;:]$/.test(raw);
		if (!word) {
			continue;
		}
		if (/\p{N}/u.test(word)) {
			anchors.push(word);
			continue;
		}
		const parts = word.split(/[^\p{L}']+/u).filter(Boolean);
		parts.forEach((part, index) => {
			const lower = part.toLowerCase();
			if (/^[A-Z]{2,}$/.test(part)) {
				anchors.push(part);
			} else if (lower.endsWith("n't") || NEGATIONS.has(lower)) {
				anchors.push(lower === "no" ? "no" : "not");
			} else if (polarBase(part)) {
				anchors.push(polarBase(part) as string);
			} else if (
				!(atSentenceStart && index === 0) &&
				/^\p{Lu}\p{Ll}+$/u.test(part)
			) {
				anchors.push(part);
			}
		});
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
