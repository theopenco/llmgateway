import crypto from "crypto";

import { logger } from "@llmgateway/logger";

import { storageRedisClient } from "./storage-redis.js";

const CONTRACTIONS: Record<string, string[]> = {
	"what's": ["what", "is"],
	"where's": ["where", "is"],
	"how's": ["how", "is"],
	"who's": ["who", "is"],
	"it's": ["it", "is"],
	"that's": ["that", "is"],
	"there's": ["there", "is"],
	"i'm": ["i", "am"],
	"won't": ["will", "not"],
	"can't": ["can", "not"],
	cannot: ["can", "not"],
};

/** Dropped unless it sits next to a quote, where it is the subject: "Translate 'please'". */
const IGNORED_WORDS = new Set(["please"]);

const QUOTES = new Set(["'", '"']);

const TERMINATORS = new Set(["?", ".", "!"]);

const FRAME_EQUIVALENTS: Record<string, string> = {
	"how can i": "how do i",
	"where can i": "where do i",
};

const FIRST_TOKEN_EQUIVALENTS: Record<string, string> = {
	which: "what",
};

const FRAMES = Object.entries(FRAME_EQUIVALENTS).map(([from, to]) => ({
	from: from.split(" "),
	to: to.split(" "),
}));

/**
 * Fenced code, closed or running to the end of the text, then inline code.
 * Both are compared verbatim, whitespace included.
 */
const CODE = /(```[\s\S]*?(?:```|$)|`[^`]*`)/;

const PROSE_TOKEN = /\p{L}+(?:'\p{L}+)*|\p{N}+(?:[.,]\p{N}+)*|\S/gu;

/** Lowercase or "Paris"-style words fold; "mW", "CSS" and "iPhone" keep their case. */
const FOLDABLE_CASE = /^\p{Lu}?\p{Ll}*(?:'\p{Ll}+)*$/u;

function proseTokens(prose: string): string[] {
	const tokens: string[] = [];
	for (const raw of prose.match(PROSE_TOKEN) ?? []) {
		const token = FOLDABLE_CASE.test(raw) ? raw.toLowerCase() : raw;
		const expanded = CONTRACTIONS[token];
		if (expanded) {
			tokens.push(...expanded);
		} else if (token.endsWith("n't")) {
			tokens.push(token.slice(0, -3), "not");
		} else {
			tokens.push(token);
		}
	}
	return tokens;
}

function tokenize(text: string): string[] {
	const normalized = text
		.normalize("NFKC")
		.replace(/[‘’ʼ]/g, "'")
		.replace(/[“”]/g, '"');
	// Splitting on a capturing pattern puts the code spans at odd indexes.
	return normalized
		.split(CODE)
		.flatMap((part, i) => (i % 2 === 1 ? [part] : proseTokens(part)));
}

function replaceFrames(tokens: string[]): string[] {
	const out: string[] = [];
	for (let i = 0; i < tokens.length; i++) {
		const frame = FRAMES.find(({ from }) =>
			from.every((word, offset) => tokens[i + offset] === word),
		);
		if (frame) {
			out.push(...frame.to);
			i += frame.from.length - 1;
		} else {
			out.push(tokens[i]);
		}
	}
	return out;
}

/**
 * Key of a final user turn for the semantic cache. Two turns match only when
 * their keys are equal, so this is exact comparison that ignores a short,
 * explicit list of differences: Unicode compatibility forms, curly quotes,
 * the case of plain words, whitespace outside code, contractions, trailing
 * "?", "." and "!", "please", "how/where can I" for "how/where do I", and a
 * leading "which" for "what". Every other word, number, symbol and code
 * character must be identical.
 */
export function normalizedPromptKey(text: string): string {
	const tokens = tokenize(text);
	const kept = tokens.filter(
		(token, i) =>
			!IGNORED_WORDS.has(token) ||
			QUOTES.has(tokens[i - 1]) ||
			QUOTES.has(tokens[i + 1]),
	);
	while (kept.length > 0 && TERMINATORS.has(kept[kept.length - 1])) {
		kept.pop();
	}
	const framed = replaceFrames(kept);
	if (framed.length > 0 && FIRST_TOKEN_EQUIVALENTS[framed[0]]) {
		framed[0] = FIRST_TOKEN_EQUIVALENTS[framed[0]];
	}
	return JSON.stringify(framed);
}

/** JSON with object keys sorted, so key order in a request never splits the cache. */
function stableJson(value: unknown): string {
	return JSON.stringify(value, (_key, nested: unknown) =>
		nested && typeof nested === "object" && !Array.isArray(nested)
			? Object.fromEntries(
					Object.entries(nested).sort(([a], [b]) => (a < b ? -1 : 1)),
				)
			: nested,
	);
}

/**
 * Redis key of the pointer for one semantic scope: every request field that
 * shapes the answer, with the final user turn reduced to
 * `normalizedPromptKey`. Its value is the response-cache key to replay.
 */
export function semanticCachePointerKey(
	projectId: string,
	scope: Record<string, unknown>,
): string {
	const hash = crypto
		.createHash("sha256")
		.update(stableJson(scope))
		.digest("hex");
	return `semcache:${projectId}:${hash}`;
}

const POINTER_READ_TIMEOUT_MS = 250;

/**
 * The response-cache key a pointer names, or null. A Redis error or a read
 * slower than 250 ms is a miss: the lookup must never fail or stall a request.
 */
export async function getSemanticCachePointer(
	pointerKey: string,
): Promise<string | null> {
	let timer: NodeJS.Timeout | undefined;
	const timeout = new Promise<null>((resolve) => {
		timer = setTimeout(() => {
			logger.warn("Semantic cache pointer read timed out", {
				timeoutMs: POINTER_READ_TIMEOUT_MS,
			});
			resolve(null);
		}, POINTER_READ_TIMEOUT_MS);
	});
	try {
		return await Promise.race([storageRedisClient.get(pointerKey), timeout]);
	} catch (error) {
		logger.error("Error reading semantic cache pointer", error as Error);
		return null;
	} finally {
		clearTimeout(timer);
	}
}

/** Never rejects, so callers can fire and forget it. */
export async function setSemanticCachePointer(
	pointerKey: string,
	cacheKey: string,
	expirationSeconds: number,
): Promise<void> {
	try {
		await storageRedisClient.set(pointerKey, cacheKey, "EX", expirationSeconds);
	} catch (error) {
		logger.error("Error writing semantic cache pointer", error as Error);
	}
}
