import { encode } from "gpt-tokenizer/encoding/o200k_base";

/**
 * Real BPE token counting in the browser.
 *
 * We ship a single encoding — `o200k_base` — which is the tokenizer used by
 * the modern OpenAI families (GPT-4o, GPT-4.1, GPT-5 and the o-series) and is
 * a close, well-behaved approximation for Claude, Gemini, Llama, DeepSeek,
 * Mistral and the rest, none of which publish a browser-runnable tokenizer.
 * Shipping one encoding keeps this lazily-loaded chunk to ~1 MB gzipped.
 */
export const TOKENIZER_NAME = "GPT-4o (o200k_base)";

export function countTokens(text: string): number {
	if (!text) {
		return 0;
	}
	return encode(text).length;
}

export function countWords(text: string): number {
	const trimmed = text.trim();
	if (!trimmed) {
		return 0;
	}
	return trimmed.split(/\s+/).length;
}
