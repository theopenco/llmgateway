import { fitTitle } from "@llmgateway/shared/seo-title";

export function pageTitle(title: string) {
	return fitTitle(title, " | LLM Gateway", ["LLM Gateway"]);
}
