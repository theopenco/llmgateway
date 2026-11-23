import { createHmac } from "node:crypto";

import { redisClient } from "@llmgateway/cache";
import { contentFilterModerationCacheTotal } from "@llmgateway/instrumentation/metrics";
import { logger } from "@llmgateway/logger";
import { getApiKeyHashSecret } from "@llmgateway/shared/api-key-hash";

/** One chunk's moderation verdict as OpenAI returned it; never the text. */
export interface CachedModerationResult {
	flagged?: boolean;
	categories?: Record<string, boolean>;
	category_scores?: Record<string, number>;
	category_applied_input_types?: Record<string, string[]>;
}

const KEY_PREFIX = "content-filter-moderation:v1:";
export const MODERATION_CACHE_TTL_SECONDS = 60 * 60;
/** Redis is an optimization here: past this, moderate as if it missed. */
const MODERATION_CACHE_TIMEOUT_MS = 100;

/**
 * Cache key of one text chunk. Scoped by organization so one tenant cannot
 * time another's prompts, and keyed by HMAC so Redis holds no plaintext.
 */
export function moderationCacheKey(
	organizationId: string,
	model: string,
	text: string,
): string {
	const digest = createHmac("sha256", getApiKeyHashSecret())
		.update(KEY_PREFIX)
		.update(JSON.stringify([organizationId, model, text]))
		.digest("hex");
	return `${KEY_PREFIX}${digest}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseCachedResult(raw: string): CachedModerationResult | undefined {
	const parsed: unknown = JSON.parse(raw);
	if (!isRecord(parsed) || !isRecord(parsed.category_scores)) {
		return undefined;
	}
	return parsed as CachedModerationResult;
}

/** The fields worth caching; drops anything else the response carried. */
export function toCachedModerationResult(
	result: CachedModerationResult,
): CachedModerationResult {
	return {
		...(result.flagged !== undefined ? { flagged: result.flagged } : {}),
		...(result.categories ? { categories: result.categories } : {}),
		...(result.category_scores
			? { category_scores: result.category_scores }
			: {}),
		...(result.category_applied_input_types
			? { category_applied_input_types: result.category_applied_input_types }
			: {}),
	};
}

async function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<never>((_, reject) => {
				timer = setTimeout(
					() => reject(new Error(`${label} timed out`)),
					MODERATION_CACHE_TIMEOUT_MS,
				);
			}),
		]);
	} finally {
		if (timer) {
			clearTimeout(timer);
		}
	}
}

/**
 * Cached verdicts for `keys`, in order, `undefined` for a miss. Returns null
 * when the cache cannot answer in time; the caller then moderates every chunk.
 */
export async function readModerationCache(
	keys: string[],
): Promise<(CachedModerationResult | undefined)[] | null> {
	if (keys.length === 0) {
		return [];
	}
	try {
		if (redisClient.status !== "ready") {
			throw new Error("Moderation cache is not ready");
		}
		const values = await withTimeout(
			redisClient.mget(...keys),
			"Moderation cache read",
		);
		let corrupt = 0;
		const results = values.map((value) => {
			if (value === null) {
				return undefined;
			}
			try {
				const parsed = parseCachedResult(value);
				corrupt += parsed ? 0 : 1;
				return parsed;
			} catch {
				corrupt++;
				return undefined;
			}
		});
		if (corrupt > 0) {
			logger.warn("Ignoring unreadable moderation cache entries", { corrupt });
		}
		const hits = results.filter((result) => result !== undefined).length;
		contentFilterModerationCacheTotal.inc({ result: "hit" }, hits);
		contentFilterModerationCacheTotal.inc(
			{ result: "miss" },
			results.length - hits,
		);
		return results;
	} catch (error) {
		contentFilterModerationCacheTotal.inc({ result: "error" }, keys.length);
		logger.warn("Moderation cache unavailable; moderating every chunk", {
			error,
		});
		return null;
	}
}

/** Store fresh verdicts without holding up the request. */
export function writeModerationCache(
	entries: { key: string; result: CachedModerationResult }[],
): void {
	if (entries.length === 0 || redisClient.status !== "ready") {
		return;
	}
	const pipeline = redisClient.pipeline();
	for (const { key, result } of entries) {
		pipeline.set(
			key,
			JSON.stringify(toCachedModerationResult(result)),
			"EX",
			MODERATION_CACHE_TTL_SECONDS,
		);
	}
	void pipeline
		.exec()
		.then((replies) => {
			const failed = replies?.find(([error]) => error)?.[0];
			if (failed) {
				logger.warn("Failed to write moderation cache", { error: failed });
			}
		})
		.catch((error: unknown) => {
			logger.warn("Failed to write moderation cache", { error });
		});
}
