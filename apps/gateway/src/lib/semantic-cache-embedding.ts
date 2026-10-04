import { logger, toError } from "@llmgateway/logger";

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

/**
 * The text a semantic-cache lookup embeds: the latest messages with their
 * roles, so two conversations only match when their recent turns agree.
 * Null when a recent message carries non-text content (images, audio), which
 * the embedding cannot represent and must not be matched on.
 */
export function semanticCacheText(messages: BaseMessage[]): string | null {
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
	return text ? text.slice(-MAX_EMBEDDED_CHARS) : null;
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
	const baseUrl = (
		process.env.SEMANTIC_CACHE_EMBEDDING_BASE_URL ??
		process.env.LLM_OPENAI_BASE_URL ??
		"https://api.openai.com"
	).replace(/\/+$/, "");
	return {
		url: `${baseUrl}/v1/embeddings`,
		apiKey,
		model:
			process.env.SEMANTIC_CACHE_EMBEDDING_MODEL ?? "text-embedding-3-small",
	};
}

/**
 * Embeds text for the semantic cache with the deployment's own embedding
 * credential. Returns null (a cache miss) when no credential is configured or
 * the call fails: the semantic cache is an optimisation and must never fail
 * or delay a request beyond the short timeout.
 */
export async function embedForSemanticCache(
	text: string,
): Promise<number[] | null> {
	const config = embeddingConfig();
	if (!config) {
		logger.warn("Semantic cache enabled but no embedding credential is set");
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
			embedding.every((value) => typeof value === "number")
			? embedding
			: null;
	} catch (error) {
		logger.warn("Semantic cache embedding request errored", {
			error: toError(error),
		});
		return null;
	}
}
