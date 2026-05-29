import { source } from "@/lib/source";

import type { InferPageType } from "fumadocs-core/source";

// cached forever
export const revalidate = false;

const SITE_URL = "https://llmgateway.io";
const DOCS_URL = "https://docs.llmgateway.io";

type Page = InferPageType<typeof source>;

// Section headings keyed by the first URL segment, in the order they should
// appear. Pages whose first segment isn't listed fall back to "Getting Started",
// and OpenAPI reference pages (v1_*, health) are grouped under "API Reference".
const SECTIONS: { key: string; title: string }[] = [
	{ key: "", title: "Getting Started" },
	{ key: "features", title: "Features" },
	{ key: "guides", title: "Guides & AI Tooling" },
	{ key: "integrations", title: "Provider Integrations" },
	{ key: "learn", title: "Platform & Dashboard" },
	{ key: "migrations", title: "Migration Guides" },
	{ key: "resources", title: "Resources" },
	{ key: "api", title: "API Reference" },
];

function sectionKey(page: Page): string {
	const first = page.url.split("/").filter(Boolean)[0] ?? "";
	if (first.startsWith("v1") || first === "health") {
		return "api";
	}
	return SECTIONS.some((s) => s.key === first) ? first : "";
}

export async function GET() {
	const pages = source.getPages();

	const grouped = new Map<string, string[]>();
	for (const page of pages) {
		const key = sectionKey(page);
		const line = `- [${page.data.title}](${DOCS_URL}${page.url})${page.data.description ? `: ${page.data.description}` : ""}`;
		const existing = grouped.get(key);
		if (existing) {
			existing.push(line);
		} else {
			grouped.set(key, [line]);
		}
	}

	const docSections = SECTIONS.filter((s) => grouped.has(s.key))
		.map((s) => `## ${s.title}\n\n${grouped.get(s.key)!.join("\n")}`)
		.join("\n\n");

	const content = `# LLM Gateway

> LLM Gateway is an open-source, OpenAI-compatible API gateway that routes, manages, and analyzes LLM requests across 20+ providers (OpenAI, Anthropic, Google, and more) through a single unified API. Switch providers without changing code, manage API keys centrally, track usage and cost, add caching and guardrails, and self-host or use the managed cloud.

## Key facts

- One OpenAI-compatible API for 20+ providers and 200+ models.
- Migrate by changing only the base URL (\`https://api.llmgateway.io/v1\`) and your API key — no code rewrites.
- Open source (AGPLv3 core) with a managed cloud option; self-hosting supported via Docker.
- Built-in usage analytics, per-model/provider cost breakdowns, automatic routing, fallbacks, caching, and guardrails.
- API base URL: \`https://api.llmgateway.io/v1\` · Docs: ${DOCS_URL} · Site: ${SITE_URL}

## Product pages

- [Home](${SITE_URL}): Unified API for multiple LLM providers.
- [Models](${SITE_URL}/models): Browse 200+ supported models with pricing and capabilities.
- [Providers](${SITE_URL}/providers): All supported LLM providers.
- [Pricing](${SITE_URL}/pricing): Plans and pricing.
- [Enterprise](${SITE_URL}/enterprise): Self-hosting, SSO, and team features.
- [Token Cost Calculator](${SITE_URL}/token-cost-calculator): Estimate and compare LLM costs across models.
- [LLM Gateway vs LiteLLM](${SITE_URL}/compare/litellm)
- [LLM Gateway vs OpenRouter](${SITE_URL}/compare/open-router)
- [LLM Gateway vs Portkey](${SITE_URL}/compare/portkey)

${docSections}`;

	return new Response(content, {
		headers: {
			"Content-Type": "text/plain; charset=utf-8",
		},
	});
}
