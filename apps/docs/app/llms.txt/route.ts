import { docsBaseUrl } from "@/lib/base-url";
import { marketingGuideCanonical } from "@/lib/guide-canonical";
import { source } from "@/lib/source";

import type { InferPageType } from "fumadocs-core/source";

export const dynamic = "force-dynamic";

const SITE_URL = "https://llmgateway.io";
const DOCS_URL = docsBaseUrl;

type Page = InferPageType<typeof source>;

// Section headings keyed by the first URL segment, in the order they should
// appear. Pages whose first segment isn't listed fall back to "Getting Started",
// and OpenAPI reference pages (v1_*, health) are grouped under "API Reference".
const SECTIONS: { key: string; title: string }[] = [
	{ key: "", title: "Getting Started" },
	{ key: "developers", title: "Developer Resources" },
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
		const line = `- [${page.data.title}](${marketingGuideCanonical(page.url) ?? `${DOCS_URL}${page.url}`})${page.data.description ? `: ${page.data.description}` : ""}`;
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

> LLM Gateway is an open-source, OpenAI-compatible API gateway for routing, managing, and analyzing requests across LLM providers. Use one API key, track usage and cost, configure caching and guardrails, and self-host or use the managed cloud.

Use the live [model catalogue](${SITE_URL}/models) for availability, pricing, and capabilities. The API base URL is \`https://api.llmgateway.io/v1\`. Migrate by changing your SDK base URL and API key. The AGPLv3 core is self-hostable with Docker; a managed cloud is also available.

## Developer entry points

- [LLM Gateway developer resources](${SITE_URL}/developers): Documentation, authentication, dashboard, and MCP.
- [LLM Gateway OpenAPI specification](${SITE_URL}/openapi.json): Typed request, response, and error schemas.
- [LLM Gateway developer dashboard](${SITE_URL}/dashboard): Projects, API keys, usage, and budgets.

## Product pages

- [Home](${SITE_URL}): Unified API for multiple LLM providers.
- [Models](${SITE_URL}/models): Browse supported models with pricing and capabilities.
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
