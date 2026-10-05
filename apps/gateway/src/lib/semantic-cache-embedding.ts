import { trimSlashes } from "@llmgateway/actions";
import { semanticAnchors } from "@llmgateway/cache";
import { logger, toError } from "@llmgateway/logger";
import { isProviderUrlGuardEnabled } from "@llmgateway/shared";

import type { BaseMessage } from "@llmgateway/models";

const EMBEDDING_TIMEOUT_MS = 2_000;
const MAX_EMBEDDED_CHARS = 8_000;
/**
 * Below this, prompts are too short for an embedding to separate: "yes" and
 * "no", "confirm" and "cancel" score above any usable threshold.
 */
export const MIN_EMBEDDED_CHARS = 16;
/**
 * OpenAI's text-embedding-3 models can be truncated to fewer dimensions with
 * little loss; 256 keeps a scope's whole list under half a megabyte.
 */
const DEFAULT_OPENAI_DIMENSIONS = 256;

const BREAKER_FAILURES = 3;
const BREAKER_OPEN_MS = 30_000;

function messageText(content: unknown): string {
	if (typeof content === "string") {
		return content;
	}
	if (Array.isArray(content)) {
		return content
			.map((part) =>
				part &&
				typeof part === "object" &&
				"type" in part &&
				part.type === "text" &&
				"text" in part &&
				typeof part.text === "string"
					? part.text
					: "",
			)
			.filter(Boolean)
			.join("\n");
	}
	return "";
}

export interface SemanticCacheInput {
	/** The final user turn, embedded and matched by meaning. */
	text: string;
	/** Anchor tokens of `text`; a match must carry the same ones in order. */
	anchors: string[];
	/**
	 * What the embedding leaves out: every other message (system prompt,
	 * history), the final turn's other fields (name, tool calls) and text past
	 * the size limit. It goes into the scope key, so it must match exactly.
	 */
	context: {
		messages: BaseMessage[];
		last: Partial<BaseMessage>;
		truncated: string;
	};
}

/**
 * Splits a conversation for a semantic-cache lookup: only the final user turn
 * is matched by meaning, everything else must be identical. Null when there is
 * no final user turn, it is too short to separate from its opposites, or it
 * carries non-text content (images, audio) the embedding cannot represent.
 */
export function semanticCacheInput(
	messages: BaseMessage[],
): SemanticCacheInput | null {
	const last = messages[messages.length - 1];
	if (!last || last.role !== "user") {
		return null;
	}
	const content = (last as { content?: unknown }).content;
	if (
		Array.isArray(content) &&
		content.some(
			(part) =>
				part &&
				typeof part === "object" &&
				"type" in part &&
				part.type !== "text",
		)
	) {
		return null;
	}
	const text = messageText(content).trim();
	if (text.length < MIN_EMBEDDED_CHARS) {
		return null;
	}
	const embedded = text.slice(0, MAX_EMBEDDED_CHARS);
	return {
		text: embedded,
		anchors: semanticAnchors(embedded),
		context: {
			messages: messages.slice(0, -1),
			last: { ...last, content: undefined },
			truncated: text.slice(MAX_EMBEDDED_CHARS),
		},
	};
}

function embeddingConfig(): {
	url: string;
	apiKey: string;
	model: string;
	dimensions: number | undefined;
} | null {
	const apiKey = (
		process.env.SEMANTIC_CACHE_EMBEDDING_API_KEY ??
		process.env.LLM_OPENAI_API_KEY ??
		""
	)
		.split(",")[0]
		?.trim();
	if (!apiKey) {
		return null;
	}
	const baseUrl = trimSlashes(
		process.env.SEMANTIC_CACHE_EMBEDDING_BASE_URL ??
			process.env.LLM_OPENAI_BASE_URL ??
			"https://api.openai.com",
		{ end: true },
	);
	const model =
		process.env.SEMANTIC_CACHE_EMBEDDING_MODEL ?? "text-embedding-3-small";
	const configuredDimensions = Number(
		process.env.SEMANTIC_CACHE_EMBEDDING_DIMENSIONS,
	);
	const dimensions =
		Number.isInteger(configuredDimensions) && configuredDimensions > 0
			? configuredDimensions
			: model.startsWith("text-embedding-3")
				? DEFAULT_OPENAI_DIMENSIONS
				: undefined;
	return { url: `${baseUrl}/v1/embeddings`, apiKey, model, dimensions };
}

export interface SemanticCacheEmbedding {
	vector: number[];
	/** Model and dimension count: vectors from different ones are not comparable. */
	model: string;
}

/**
 * Trips after consecutive failures so an embedding outage costs at most a few
 * timeouts, not one per cache miss.
 */
const breaker = { failures: 0, openUntil: 0 };

export function resetSemanticCacheEmbeddingBreaker(): void {
	breaker.failures = 0;
	breaker.openUntil = 0;
}

function recordFailure(): void {
	breaker.failures++;
	if (breaker.failures >= BREAKER_FAILURES) {
		breaker.openUntil = Date.now() + BREAKER_OPEN_MS;
		breaker.failures = 0;
		logger.warn("Semantic cache embedding paused after repeated failures", {
			pauseMs: BREAKER_OPEN_MS,
		});
	}
}

/**
 * Embeds text for the semantic cache with the deployment's own embedding
 * credential. Returns null (a cache miss) when no credential is configured,
 * the breaker is open or the call fails: the semantic cache is an
 * optimisation and must never fail or delay a request beyond the short
 * timeout. Token usage is logged per project so the platform's embedding
 * spend can be attributed.
 */
export async function embedForSemanticCache(
	text: string,
	attribution: { projectId: string },
): Promise<SemanticCacheEmbedding | null> {
	const config = embeddingConfig();
	if (!config) {
		logger.warn("Semantic cache enabled but no embedding credential is set");
		return null;
	}
	// Prompt text and the bearer key must never cross the network in cleartext.
	if (
		isProviderUrlGuardEnabled() &&
		!config.url.toLowerCase().startsWith("https://")
	) {
		logger.warn("Semantic cache embedding URL must use https");
		return null;
	}
	if (Date.now() < breaker.openUntil) {
		return null;
	}
	const startedAt = Date.now();
	try {
		const res = await fetch(config.url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${config.apiKey}`,
			},
			body: JSON.stringify({
				model: config.model,
				input: text,
				...(config.dimensions ? { dimensions: config.dimensions } : {}),
			}),
			// A redirect would resend the prompt to wherever it points.
			redirect: "error",
			signal: AbortSignal.timeout(EMBEDDING_TIMEOUT_MS),
		});
		if (!res.ok) {
			recordFailure();
			logger.warn("Semantic cache embedding request failed", {
				status: res.status,
			});
			return null;
		}
		const json = (await res.json()) as {
			data?: { embedding?: unknown }[];
			usage?: { total_tokens?: unknown };
		};
		const embedding = json.data?.[0]?.embedding;
		if (
			!Array.isArray(embedding) ||
			embedding.length === 0 ||
			!embedding.every((value) => typeof value === "number")
		) {
			recordFailure();
			return null;
		}
		breaker.failures = 0;
		logger.info("Semantic cache embedding", {
			projectId: attribution.projectId,
			model: config.model,
			tokens:
				typeof json.usage?.total_tokens === "number"
					? json.usage.total_tokens
					: null,
			durationMs: Date.now() - startedAt,
		});
		return {
			vector: embedding,
			model: `${config.model}:${config.dimensions ?? embedding.length}`,
		};
	} catch (error) {
		recordFailure();
		logger.warn("Semantic cache embedding request errored", {
			error: toError(error),
		});
		return null;
	}
}
