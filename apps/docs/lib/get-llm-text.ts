import type { source } from "@/lib/source";
import type { InferPageType } from "fumadocs-core/source";

const DOCS_URL = "https://docs.llmgateway.io";

// Navigation-card components whose target pages are already concatenated in
// full elsewhere in llms-full.txt; interactive embeds have no text value and
// are dropped entirely.
const MDX_COMPONENT_REPLACEMENTS: Record<string, string> = {
	FeatureCards: `All features are documented under ${DOCS_URL}/features; each feature page is included in full in this file.`,
	AIToolingCards: `AI tooling: ${DOCS_URL}/llms.txt (docs index for LLMs), ${DOCS_URL}/llms-full.txt (this file), ${DOCS_URL}/guides/mcp (MCP server), ${DOCS_URL}/guides/agent-skills (agent skills), and https://llmgateway.io/templates (templates and agents).`,
	SelfHostCards: `Self-hosting guides are documented under ${DOCS_URL}/self-host and included in full in this file.`,
};

// Raw MDX component tags mean nothing to LLM readers; swap known navigation
// components for text pointers and drop the rest instead of leaking JSX.
// Fenced code blocks are left untouched so JSX code samples survive.
function replaceMdxComponents(text: string): string {
	return text
		.split(/(```[\s\S]*?```)/)
		.map((segment) =>
			segment.startsWith("```")
				? segment
				: segment
						.replace(
							/^[ \t]*<([A-Z][A-Za-z0-9]*)(?:\s[^>]*)?\/>[ \t]*$/gm,
							(_match, name: string) => MDX_COMPONENT_REPLACEMENTS[name] ?? "",
						)
						.replace(/\n{3,}/g, "\n\n"),
		)
		.join("");
}

export async function getLLMText(page: InferPageType<typeof source>) {
	const processed = await page.data.getText("processed");
	// Root-relative markdown links would be resolved against whatever domain
	// serves this text (llmgateway.io proxies /llms-full.txt), so make them
	// absolute docs URLs.
	const absolute = processed.replace(/\]\((\/[^)\s]*)\)/g, `](${DOCS_URL}$1)`);
	return `# ${page.data.title}
URL: ${DOCS_URL}${page.url}
${replaceMdxComponents(absolute)}`;
}
