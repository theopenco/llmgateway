import {
	embedForSemanticCache,
	semanticCacheInput,
} from "@/lib/semantic-cache-embedding.js";

import {
	addSemanticCacheEntry,
	findSemanticCacheHit,
	generateSemanticCacheScopeKey,
} from "@llmgateway/cache";

import type { SemanticCacheMode } from "@llmgateway/db";
import type { BaseMessage } from "@llmgateway/models";

/** Written to the log row so every semantic decision can be audited later. */
export interface SemanticCacheAudit {
	similarity: number;
	matchedCacheKey: string;
	/** False in shadow mode: the match was recorded but the request went upstream. */
	served: boolean;
}

export interface SemanticCacheLookup<T> {
	/** Only set in "on" mode: the response to replay. */
	hit: { response: T; audit: SemanticCacheAudit } | null;
	/** Set in shadow mode when a match existed but was not served. */
	audit: SemanticCacheAudit | null;
	/** Call once the upstream response is cached under `cacheKey`. */
	remember: (cacheKey: string, expirationSeconds: number) => Promise<void>;
}

const noLookup: SemanticCacheLookup<never> = {
	hit: null,
	audit: null,
	remember: async () => {},
};

/**
 * One semantic-cache round trip for an exact-cache miss. `scope` is every
 * request field except the messages; the final user turn is embedded and
 * everything else is folded into the scope so it must match exactly.
 */
export async function semanticCacheLookup<T>(options: {
	projectId: string;
	mode: SemanticCacheMode;
	threshold: number;
	messages: BaseMessage[];
	scope: Record<string, unknown>;
	load: (cacheKey: string) => Promise<T | null>;
}): Promise<SemanticCacheLookup<T>> {
	if (options.mode === "off") {
		return noLookup;
	}
	const input = semanticCacheInput(options.messages);
	if (!input) {
		return noLookup;
	}
	const embedding = await embedForSemanticCache(input.text, {
		projectId: options.projectId,
	});
	if (!embedding) {
		return noLookup;
	}
	const scopeKey = generateSemanticCacheScopeKey(options.projectId, {
		...options.scope,
		messages: undefined,
		semanticContext: input.context,
		embeddingModel: embedding.model,
	});
	const query = {
		embedding: embedding.vector,
		anchors: input.anchors,
		wordKeys: input.wordKeys,
	};
	const remember = (cacheKey: string, expirationSeconds: number) =>
		addSemanticCacheEntry(scopeKey, { cacheKey, ...query }, expirationSeconds);
	const match = await findSemanticCacheHit(
		scopeKey,
		query,
		options.threshold,
		options.load,
	);
	if (!match) {
		return { hit: null, audit: null, remember };
	}
	const served = options.mode === "on";
	const audit: SemanticCacheAudit = {
		similarity: Number(match.similarity.toFixed(4)),
		matchedCacheKey: match.cacheKey,
		served,
	};
	return served
		? { hit: { response: match.response, audit }, audit, remember }
		: { hit: null, audit, remember };
}
