import crypto from "crypto";

import { logger } from "@llmgateway/logger";

import { storageRedisClient } from "./storage-redis.js";

/**
 * Bumped whenever `normalizedPromptKey` changes, so pointers written under an
 * older rule are never served.
 */
const PROMPT_RULE_VERSION = 2;

/** Fenced code, closed or running to the end of the text, then inline code. */
const CODE = /(```[\s\S]*?(?:```|$)|`[^`]*`)/;

/**
 * Question openers whose capitalisation never changes the answer. Only the
 * message's first word is folded, and only when it is one of these.
 */
const OPENERS = new Set([
	"how",
	"what",
	"what's",
	"which",
	"where",
	"when",
	"why",
	"who",
	"can",
	"could",
	"do",
	"does",
	"is",
	"are",
]);

/**
 * Rewordings that carry nearly all hits. They apply only at the start of the
 * message: anywhere else the same words can be quoted or mentioned text.
 */
const OPENING_EQUIVALENTS: [RegExp, string][] = [
	[/^(how|where) (?:can|do) [iI]\b/, "$1 do I"],
	[/^what's\b/, "what is"],
	[/^which\b/, "what"],
];

function normalizeOpening(prose: string): string {
	const folded = prose.replace(/^\p{L}+(?:'\p{L}+)?/u, (word) =>
		OPENERS.has(word.toLowerCase()) ? word.toLowerCase() : word,
	);
	return OPENING_EQUIVALENTS.reduce(
		(text, [pattern, replacement]) => text.replace(pattern, replacement),
		folded,
	);
}

/**
 * Key of a final user turn for the semantic cache, or null when nothing is
 * left to compare. Two turns match only when their keys are equal, so this is
 * exact comparison that ignores only: whitespace at either end, curly
 * apostrophes outside code, the case of a leading question word, "how/where
 * can I" for "how/where do I", a leading "which" for "what" and "what's" for
 * "what is", and a trailing "?" or ".". Code is compared verbatim.
 */
export function normalizedPromptKey(text: string): string | null {
	// Splitting on a capturing pattern puts the code spans at odd indexes.
	const parts = text
		.trim()
		.split(CODE)
		.map((part, i) => (i % 2 === 1 ? part : part.replace(/[‘’ʼ]/g, "'")));
	parts[0] = normalizeOpening(parts[0]);
	const last = parts.length - 1;
	if (last % 2 === 0) {
		parts[last] = parts[last].replace(/\s*[?.]+$/, "");
	}
	return parts.join("") === "" ? null : JSON.stringify(parts);
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
	return `semcache:v${PROMPT_RULE_VERSION}:${projectId}:${hash}`;
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
