import { fitTitle } from "@llmgateway/shared/seo-title";

export function pageTitle(title: string) {
	return fitTitle(title, " | Airside by LLM Gateway", [
		"Airside",
		"LLM Gateway",
	]);
}
