import { trimSlashes } from "@llmgateway/actions";
import { logger, toError } from "@llmgateway/logger";
import { isProviderUrlGuardEnabled } from "@llmgateway/shared";

import type { BaseMessage } from "@llmgateway/models";

const EMBEDDING_TIMEOUT_MS = 2_000;
const MAX_EMBEDDED_CHARS = 8_000;
const MAX_EMBEDDED_MESSAGES = 8;

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
	/** The latest messages with their roles, embedded and matched by meaning. */
	text: string;
	/**
	 * What the embedding leaves out: earlier messages and text past the size
	 * limit. It goes into the scope key, so it must match exactly.
	 */
	context: { earlier: BaseMessage[]; truncated: string };
}

/**
 * Splits a conversation for a semantic-cache lookup, so two conversations
 * only match when their recent turns agree in meaning and everything else is
 * identical. Null when a recent message carries non-text content (images,
 * audio), which the embedding cannot represent and must not be matched on.
 */
export function semanticCacheInput(
	messages: BaseMessage[],
): SemanticCacheInput | null {
	const recent = messages.slice(-MAX_EMBEDDED_MESSAGES);
	const lines: string[] = [];
	for (const message of recent) {
		const content = (message as { content?: unknown }).content;
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
		lines.push(`${message.role}: ${messageText(content)}`);
	}
	const text = lines.join("\n").trim();
	if (!text) {
		return null;
	}
	return {
		text: text.slice(-MAX_EMBEDDED_CHARS),
		context: {
			earlier: messages.slice(0, -MAX_EMBEDDED_MESSAGES),
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
