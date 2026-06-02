import type { source } from "@/lib/source";
import type { InferPageType } from "fumadocs-core/source";

const DOCS_URL = "https://docs.llmgateway.io";

export async function getLLMText(page: InferPageType<typeof source>) {
	const processed = await page.data.getText("processed");
	return `# ${page.data.title}
URL: ${DOCS_URL}${page.url}
${processed}`;
}
