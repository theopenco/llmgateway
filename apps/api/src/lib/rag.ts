import { HTTPException } from "hono/http-exception";

import { getGatewayUrl } from "@/utils/playground-key.js";

export const EMBEDDING_MODEL = "openai/text-embedding-3-small";

// Target chunk size in characters (~375 tokens), small enough that several
// chunks fit comfortably in a system prompt.
export const MAX_CHUNK_CHARS = 1500;
// Overlap between adjacent windows when a single paragraph must be hard-split.
export const CHUNK_OVERLAP_CHARS = 200;

const EMBEDDING_BATCH_SIZE = 100;
const EMBEDDING_TIMEOUT_MS = 60_000;

// Split text into chunks of at most MAX_CHUNK_CHARS, preferring paragraph
// boundaries and falling back to overlapping fixed windows for oversized
// paragraphs.
export function chunkText(text: string): string[] {
	const normalized = text.replace(/\r\n/g, "\n").trim();
	if (!normalized) {
		return [];
	}

	const paragraphs = normalized
		.split(/\n{2,}/)
		.map((p) => p.trim())
		.filter(Boolean);

	const chunks: string[] = [];
	let current = "";

	const flush = () => {
		if (current.trim()) {
			chunks.push(current.trim());
		}
		current = "";
	};

	for (const paragraph of paragraphs) {
		if (paragraph.length > MAX_CHUNK_CHARS) {
			flush();
			const step = MAX_CHUNK_CHARS - CHUNK_OVERLAP_CHARS;
			for (let start = 0; start < paragraph.length; start += step) {
				const window = paragraph.slice(start, start + MAX_CHUNK_CHARS).trim();
				if (window) {
					chunks.push(window);
				}
				if (start + MAX_CHUNK_CHARS >= paragraph.length) {
					break;
				}
			}
			continue;
		}

		if (current && current.length + paragraph.length + 2 > MAX_CHUNK_CHARS) {
			flush();
		}
		current = current ? `${current}\n\n${paragraph}` : paragraph;
	}
	flush();

	return chunks;
}

export function cosineSimilarity(a: number[], b: number[]): number {
	if (a.length !== b.length || a.length === 0) {
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

interface EmbeddingResponse {
	data?: { embedding: number[]; index: number }[];
	error?: { message?: string };
}

// Embed texts through the gateway's OpenAI-compatible /embeddings endpoint,
// billed to the same key the playground chat uses.
export async function embedTexts(
	token: string,
	texts: string[],
): Promise<number[][]> {
	const embeddings: number[][] = [];

	for (let i = 0; i < texts.length; i += EMBEDDING_BATCH_SIZE) {
		const batch = texts.slice(i, i + EMBEDDING_BATCH_SIZE);
		const res = await fetch(`${getGatewayUrl()}/embeddings`, {
			method: "POST",
			headers: {
				authorization: `Bearer ${token}`,
				"content-type": "application/json",
				"x-source": "chat.llmgateway.io",
			},
			body: JSON.stringify({ model: EMBEDDING_MODEL, input: batch }),
			signal: AbortSignal.timeout(EMBEDDING_TIMEOUT_MS),
		});

		if (!res.ok) {
			let message = `Embedding request failed with status ${res.status}`;
			try {
				const json = (await res.json()) as EmbeddingResponse;
				if (json.error?.message) {
					message = json.error.message;
				}
			} catch {
				// Keep the generic message when the error body isn't JSON.
			}
			throw new HTTPException(502, { message });
		}

		const json = (await res.json()) as EmbeddingResponse;
		if (!json.data?.length || json.data.length !== batch.length) {
			throw new HTTPException(502, {
				message: "Embedding response is missing data",
			});
		}
		const sorted = [...json.data].sort((a, b) => a.index - b.index);
		embeddings.push(...sorted.map((d) => d.embedding));
	}

	return embeddings;
}
