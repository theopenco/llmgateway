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

/** "Alice's" and "Alices'" name Alice. */
function stripPossessive(word: string): string {
	return word.replace(/'s$|'$/iu, "");
}

/**
 * Object pronouns name a party that can be an operand ("from me to Alice"),
 * unlike subject and possessive forms ("I reset my password"). They stay in
 * the word-order check so a single party swapped with a name or an account
 * is still a reordering.
 */
const OBJECT_PRONOUNS: Record<string, string> = {
	me: "@me",
	you: "@you",
	him: "@him",
	her: "@her",
	them: "@them",
	us: "@us",
};

/** Anchors kept per prompt; swaps past the cap are not checked. */
const MAX_ANCHORS = 64;

/**
 * Personal pronouns by party. Two parties in one prompt form a relation whose
 * direction the embedding blurs: "from me to him" scores the same as "from
 * him to me". A single party ("my password") is not an operand, so pronouns
 * only anchor when at least two different parties appear.
 */
const PRONOUN_PARTIES: Record<string, string> = {
	i: "@me",
	me: "@me",
	my: "@me",
	mine: "@me",
	myself: "@me",
	you: "@you",
	your: "@you",
	yours: "@you",
	yourself: "@you",
	yourselves: "@you",
	he: "@him",
	him: "@him",
	his: "@him",
	himself: "@him",
	she: "@her",
	her: "@her",
	hers: "@her",
	herself: "@her",
	they: "@them",
	them: "@them",
	their: "@them",
	theirs: "@them",
	themselves: "@them",
	we: "@us",
	us: "@us",
	our: "@us",
	ours: "@us",
	ourselves: "@us",
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
 * - capitalised names after the first word of a sentence (Paris, Tesla);
 * - the parties of personal pronouns, when two or more differ ("from me to
 *   him", "I sent it to them").
 *
 * Two prompts only match when their anchors agree in order, so "EUR to USD"
 * never replays "USD to EUR", "2+3" never replays "2+4", "sell Tesla" never
 * replays "buy Tesla", "didn't receive" never replays "received" and "from me
 * to him" never replays "from him to me".
 */
export function semanticAnchors(text: string): string[] {
	const anchors: string[] = [];
	const parties = new Set<string>();
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
		const parts = word
			.split(/[^\p{L}']+/u)
			.map(stripPossessive)
			.filter(Boolean);
		parts.forEach((part, index) => {
			const lower = part.toLowerCase();
			if (/^[A-Z]{2,}$/.test(part)) {
				anchors.push(part);
			} else if (lower.endsWith("n't") || NEGATIONS.has(lower)) {
				anchors.push(lower === "no" ? "no" : "not");
			} else if (PRONOUN_PARTIES[lower]) {
				anchors.push(PRONOUN_PARTIES[lower]);
				parties.add(PRONOUN_PARTIES[lower]);
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
	return (
		parties.size >= 2
			? anchors
			: anchors.filter((anchor) => !anchor.startsWith("@"))
	).slice(0, MAX_ANCHORS);
}

const STOP_WORDS = new Set([
	"a",
	"an",
	"the",
	"i",
	"my",
	"mine",
	"your",
	"yours",
	"we",
	"our",
	"ours",
	"he",
	"his",
	"she",
	"hers",
	"it",
	"its",
	"they",
	"their",
	"theirs",
	"this",
	"that",
	"these",
	"those",
	"am",
	"is",
	"are",
	"was",
	"were",
	"be",
	"been",
	"being",
	"do",
	"does",
	"did",
	"have",
	"has",
	"had",
	"can",
	"could",
	"should",
	"would",
	"will",
	"shall",
	"may",
	"might",
	"must",
	"to",
	"from",
	"into",
	"onto",
	"of",
	"for",
	"in",
	"at",
	"by",
	"with",
	"about",
	"as",
	"via",
	"than",
	"and",
	"or",
	"but",
	"if",
	"so",
	"then",
	"what",
	"which",
	"who",
	"whom",
	"whose",
	"how",
	"when",
	"where",
	"why",
	"please",
	"kindly",
	"just",
	"also",
	"tell",
	"let",
	"know",
	"want",
	"need",
	"like",
	"help",
	"hi",
	"hello",
	"hey",
	"thanks",
	"thank",
	"there",
	"here",
	"some",
	"any",
	"all",
	"ok",
	"okay",
	"yes",
	"no",
	"not",
]);

/**
 * The content words of a prompt, lowercased and in order, with stop words
 * removed and object pronouns kept as party tokens. Used to catch operand
 * reordering that anchors cannot see: "transfer 500 from savings to
 * checking" and "transfer 500 from checking to savings" carry the same words
 * in a different order, as do "from me to Alice" and "from Alice to me".
 */
export function semanticWords(text: string): string[] {
	const words: string[] = [];
	for (const raw of text.split(/\s+/)) {
		const word = raw
			.replace(/[\u2018\u2019\u02bc]/g, "'")
			.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")
			.toLowerCase();
		if (!word || word.endsWith("n't")) {
			continue;
		}
		const parts = /\p{N}/u.test(word)
			? [word]
			: word
					.split(/[^\p{L}']+/u)
					.map(stripPossessive)
					.filter(Boolean);
		for (const part of parts) {
			if (OBJECT_PRONOUNS[part]) {
				words.push(OBJECT_PRONOUNS[part]);
			} else if (!STOP_WORDS.has(part)) {
				words.push(
					part.length > 3 && part.endsWith("s") && !part.endsWith("ss")
						? part.slice(0, -1)
						: part,
				);
			}
		}
	}
	return words;
}

/** Content words kept per entry; swaps deeper into a prompt are not checked. */
const MAX_WORD_KEYS = 96;

/**
 * Short, order-preserving fingerprints of content words, so an entry stores
 * a few hundred bytes of word keys instead of the words themselves.
 */
export function wordKeys(words: string[]): string[] {
	return words.slice(0, MAX_WORD_KEYS).map((word) => {
		// FNV-1a, 32-bit.
		let hash = 0x811c9dc5;
		for (let i = 0; i < word.length; i++) {
			hash ^= word.charCodeAt(i);
			hash = Math.imul(hash, 0x01000193) >>> 0;
		}
		return hash.toString(36);
	});
}

/**
 * True when the words both prompts share appear in the same relative order.
 * Adding, dropping or replacing words (a rewording) passes; moving shared
 * words around each other (an operand swap) does not.
 */
export function sameWordOrder(a: string[], b: string[]): boolean {
	const inA = new Set(a);
	const inB = new Set(b);
	const sharedA = a.filter((word) => inB.has(word));
	const sharedB = b.filter((word) => inA.has(word));
	return (
		sharedA.length === sharedB.length &&
		sharedA.every((word, i) => word === sharedB[i])
	);
}

export interface SemanticCacheEntry {
	/** Response-cache key holding the cached completion. */
	cacheKey: string;
	embedding: number[];
	anchors: string[];
	/** `wordKeys` of the embedded text's content words; see `sameWordOrder`. */
	wordKeys: string[];
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

export type SemanticCacheQuery = Pick<
	SemanticCacheEntry,
	"embedding" | "anchors" | "wordKeys"
>;

/**
 * Entries with the same anchors and shared-word order at or above
 * `threshold`, most similar first.
 */
export function rankSemanticMatches<T extends SemanticCacheEntry>(
	query: SemanticCacheQuery,
	entries: T[],
	threshold: number,
): (T & { similarity: number })[] {
	return entries
		.filter(
			(entry) =>
				sameAnchors(entry.anchors, query.anchors) &&
				sameWordOrder(entry.wordKeys, query.wordKeys),
		)
		.map((entry) => ({
			...entry,
			similarity: cosineSimilarity(query.embedding, entry.embedding),
		}))
		.filter((match) => match.similarity >= threshold)
		.sort((a, b) => b.similarity - a.similarity);
}

/**
 * Scales a vector so its largest component is ±127 and rounds to integers.
 * Cosine similarity is scale-invariant, so storing 8-bit components keeps
 * similarities within about 0.002 of the full-precision value while cutting
 * the stored vector to a quarter. Both sides of a comparison are quantised,
 * so identical vectors still score exactly 1.
 */
export function quantiseEmbedding(embedding: number[]): number[] {
	let maxAbs = 0;
	for (const value of embedding) {
		maxAbs = Math.max(maxAbs, Math.abs(value));
	}
	if (maxAbs === 0) {
		return embedding.map(() => 0);
	}
	return embedding.map((value) => Math.round((value / maxAbs) * 127));
}

/**
 * One entry is about 1 KB with a 256-dimension vector (344 base64 chars),
 * at most 96 word keys and at most 64 anchors (both capped where they are
 * produced, so query and entry are cut the same way), so a full scope of
 * 512 entries reads about half a megabyte.
 */
function encodeEntry(entry: SemanticCacheEntry): string {
	return JSON.stringify({
		k: entry.cacheKey,
		a: entry.anchors,
		w: entry.wordKeys.join(" "),
		e: Buffer.from(
			new Int8Array(quantiseEmbedding(entry.embedding)).buffer,
		).toString("base64"),
	});
}

/** Null for any malformed entry, so one bad element never disables the scope. */
export function decodeSemanticCacheEntry(
	raw: string,
): SemanticCacheEntry | null {
	let parsed: { k?: unknown; a?: unknown; w?: unknown; e?: unknown };
	try {
		parsed = JSON.parse(raw) as typeof parsed;
	} catch {
		return null;
	}
	if (
		!parsed ||
		typeof parsed.k !== "string" ||
		typeof parsed.e !== "string" ||
		typeof parsed.w !== "string" ||
		!Array.isArray(parsed.a) ||
		!parsed.a.every((item) => typeof item === "string")
	) {
		return null;
	}
	const bytes = Buffer.from(parsed.e, "base64");
	if (bytes.byteLength === 0) {
		return null;
	}
	return {
		cacheKey: parsed.k,
		anchors: parsed.a as string[],
		wordKeys: parsed.w ? parsed.w.split(" ") : [],
		embedding: Array.from(
			new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
		),
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
	query: SemanticCacheQuery,
	threshold: number,
): Promise<SemanticCacheMatch[]> {
	try {
		return rankSemanticMatches(
			{ ...query, embedding: quantiseEmbedding(query.embedding) },
			await readScope(scopeKey),
			threshold,
		).map(({ cacheKey, similarity }) => ({ cacheKey, similarity }));
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
 * the list's expiry, so a stale best match is pruned and the lookup falls
 * through to the next one. The served entry moves to the front of the list so
 * repeated prompts are not evicted by one-off traffic.
 */
export async function findSemanticCacheHit<T>(
	scopeKey: string,
	query: SemanticCacheQuery,
	threshold: number,
	load: (cacheKey: string) => Promise<T | null>,
): Promise<SemanticCacheHit<T> | null> {
	let matches: (StoredEntry & { similarity: number })[];
	try {
		matches = rankSemanticMatches(
			{ ...query, embedding: quantiseEmbedding(query.embedding) },
			await readScope(scopeKey),
			threshold,
		);
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
			// The list's expiry is refreshed on every write, so an entry can
			// outlive its response. Drop it so it stops taking a probe slot.
			void storageRedisClient
				.lrem(scopeKey, 0, match.raw)
				.catch((error: unknown) =>
					logger.error("Error pruning semantic cache entry", error as Error),
				);
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
