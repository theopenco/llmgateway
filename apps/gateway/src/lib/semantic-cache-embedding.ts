import { trimSlashes } from "@llmgateway/actions";
import { logger, toError } from "@llmgateway/logger";
import { isProviderUrlGuardEnabled } from "@llmgateway/shared";

import type { BaseMessage } from "@llmgateway/models";

const EMBEDDING_TIMEOUT_MS = 2_000;
const MAX_EMBEDDED_CHARS = 8_000;

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
	/** The latest user message, embedded and matched by meaning. */
	text: string;
	/**
	 * Everything else: the system prompt, earlier messages, the latest
	 * message's other fields (name), and text past the size limit. It goes into
	 * the scope key, so it must match exactly. Embedding the system prompt would
	 * let it dominate the vector, so prompts that differ only in per-user data
	 * there (names, balances) would match and replay another user's response.
	 */
	context: {
		earlier: BaseMessage[];
		latest: Partial<BaseMessage>;
		truncated: string;
	};
}

/**
 * Splits a conversation for a semantic-cache lookup, so two conversations
 * only match when their latest user messages agree in meaning and everything
 * else is identical. Null unless the conversation ends with a text-only user
 * message: the embedding cannot represent images or audio.
 */
export function semanticCacheInput(
	messages: BaseMessage[],
): SemanticCacheInput | null {
	const latest = messages.at(-1);
	if (latest?.role !== "user") {
		return null;
	}
	const content = (latest as { content?: unknown }).content;
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
	if (!text) {
		return null;
	}
	return {
		text: text.slice(-MAX_EMBEDDED_CHARS),
		context: {
			earlier: messages.slice(0, -1),
			latest: { ...latest, content: undefined },
			truncated: text.slice(0, -MAX_EMBEDDED_CHARS),
		},
	};
}

function embeddingConfig(): {
	url: string;
	apiKey: string;
	model: string;
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
	return {
		url: `${baseUrl}/v1/embeddings`,
		apiKey,
		model:
			process.env.SEMANTIC_CACHE_EMBEDDING_MODEL ?? "text-embedding-3-small",
	};
}

export interface SemanticCacheEmbedding {
	vector: number[];
	/** Vectors from different models are not comparable. */
	model: string;
}

/**
 * Embeds text for the semantic cache with the deployment's own embedding
 * credential. Returns null (a cache miss) when no credential is configured or
 * the call fails: the semantic cache is an optimisation and must never fail
 * or delay a request beyond the short timeout.
 */
export async function embedForSemanticCache(
	text: string,
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
	try {
		const res = await fetch(config.url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${config.apiKey}`,
			},
			body: JSON.stringify({ model: config.model, input: text }),
			// A redirect would resend the prompt to wherever it points.
			redirect: "error",
			signal: AbortSignal.timeout(EMBEDDING_TIMEOUT_MS),
		});
		if (!res.ok) {
			logger.warn("Semantic cache embedding request failed", {
				status: res.status,
			});
			return null;
		}
		const json = (await res.json()) as {
			data?: { embedding?: unknown }[];
		};
		const embedding = json.data?.[0]?.embedding;
		return Array.isArray(embedding) &&
			embedding.length > 0 &&
			embedding.every((value) => typeof value === "number")
			? { vector: embedding, model: config.model }
			: null;
	} catch (error) {
		logger.warn("Semantic cache embedding request errored", {
			error: toError(error),
		});
		return null;
	}
}
