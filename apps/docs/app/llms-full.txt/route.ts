import { getLLMText } from "@/lib/get-llm-text";
import { source } from "@/lib/source";

// cached forever
export const revalidate = false;

const HEADER = `# LLM Gateway — Full Documentation

> LLM Gateway is an open-source, OpenAI-compatible API gateway that routes, manages, and analyzes LLM requests across 40+ providers (OpenAI, Anthropic, Google, and more) through a single unified API. Switch providers without changing code, manage API keys centrally, track usage and cost, add caching and guardrails, and self-host or use the managed cloud.

API base URL: https://api.llmgateway.io/v1 · Docs: https://docs.llmgateway.io · Site: https://llmgateway.io

This file concatenates the full text of every documentation page below.`;

export async function GET() {
	const scan = source.getPages().map(getLLMText);
	const scanned = await Promise.all(scan);

	return new Response([HEADER, ...scanned].join("\n\n"), {
		headers: {
			"Content-Type": "text/plain; charset=utf-8",
		},
	});
}
