import type { source } from "@/lib/source";
import type { InferPageType } from "fumadocs-core/source";

const DOCS_URL = "https://docs.llmgateway.io";

export async function getLLMText(page: InferPageType<typeof source>) {
	const processed = await page.data.getText("processed");
	// Root-relative markdown links would be resolved against whatever domain
	// serves this text (llmgateway.io proxies /llms-full.txt), so make them
	// absolute docs URLs.
	const absolute = processed.replace(/\]\((\/[^)\s]*)\)/g, `](${DOCS_URL}$1)`);
	return `# ${page.data.title}
URL: ${DOCS_URL}${page.url}
${absolute}`;
}
