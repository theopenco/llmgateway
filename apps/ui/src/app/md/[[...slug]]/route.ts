import { getConfig } from "@/lib/config-server";
import { MARKDOWN_PAGES } from "@/lib/markdown-pages";

const NOT_FOUND_MARKDOWN = `# 404 — Page not found

This path does not exist on llmgateway.io. Where to look next:

- [Site overview for agents](https://llmgateway.io/llms.txt)
- [Full docs as markdown](https://llmgateway.io/llms-full.txt)
- [OpenAPI specification](https://llmgateway.io/openapi.json)
- [Sitemap](https://llmgateway.io/sitemap.xml)
- [Documentation](https://docs.llmgateway.io)
- [Model catalog](https://llmgateway.io/models)
`;

/**
 * Serves the markdown representation of pages listed in MARKDOWN_PAGES.
 * Requests land here via the proxy's 307 redirect when the Accept header
 * prefers text/markdown over text/html (acceptmarkdown.com).
 */
export async function GET(
	_request: Request,
	{ params }: { params: Promise<{ slug?: string[] }> },
) {
	const { slug } = await params;
	const pathname = `/${(slug ?? []).join("/")}`;
	const file = MARKDOWN_PAGES[pathname];
	const headers = {
		"Content-Type": "text/markdown; charset=utf-8",
		Vary: "Accept",
		"Cache-Control": "public, max-age=3600",
		// Agent mirror, not a search result (same convention as the docs
		// site's /llms.mdx routes).
		"X-Robots-Tag": "noindex",
	};
	if (!file) {
		return new Response(NOT_FOUND_MARKDOWN, { status: 404, headers });
	}
	// Self-fetch the static file from the trusted configured origin (never
	// the request's own Host header) so this works in any deployment layout
	// without trusting attacker-controllable input.
	const res = await fetch(new URL(`/${file}`, getConfig().appUrl));
	if (!res.ok) {
		return new Response(NOT_FOUND_MARKDOWN, { status: 404, headers });
	}
	return new Response(await res.text(), { status: 200, headers });
}
