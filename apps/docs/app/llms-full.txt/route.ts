import { docsBaseUrl } from "@/lib/base-url";
import { getLLMText } from "@/lib/get-llm-text";
import { source } from "@/lib/source";

export const dynamic = "force-dynamic";

const HEADER = `# LLM Gateway — Full Documentation

> LLM Gateway is an open-source, OpenAI-compatible API gateway for routing, managing, and analyzing requests across LLM providers. Use one API key, track usage and cost, configure caching and guardrails, and self-host or use the managed cloud. Current models and pricing: https://llmgateway.io/models

API base URL: https://api.llmgateway.io/v1 · Docs: ${docsBaseUrl} · Site: https://llmgateway.io

This file concatenates the full text of every documentation page below.`;

// The output depends only on build-time content, so it is assembled once per
// server process instead of re-processing every page on each crawler hit. A
// failed build resets the memo so the next request retries.
let fullTextPromise: Promise<string> | undefined;

function getFullText(): Promise<string> {
	fullTextPromise ??= buildFullText().catch((error: unknown) => {
		fullTextPromise = undefined;
		throw error;
	});
	return fullTextPromise;
}

async function buildFullText(): Promise<string> {
	const pages = source.getPages();
	const contents = [
		"## Contents",
		`Start with ${docsBaseUrl}/llms.txt for the full page index. Read a linked Markdown page when you need one topic; this complete file may exceed an agent context window.`,
		...pages
			.filter((page) => page.slugs.length <= 1)
			.map(
				(page) =>
					`- [${page.data.title}](${docsBaseUrl}/llms.mdx${page.url === "/" ? "/index" : page.url})`,
			),
	].join("\n\n");
	const scanned = await Promise.all(pages.map(getLLMText));
	return [HEADER, contents, ...scanned].join("\n\n");
}

export async function GET() {
	return new Response(await getFullText(), {
		headers: { "Content-Type": "text/plain; charset=utf-8" },
	});
}
