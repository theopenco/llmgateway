import { fitTitle } from "@llmgateway/shared/seo-title";

export function pageTitle(title: string) {
	return fitTitle(title, " | DevPass by LLM Gateway", [
		"DevPass",
		"LLM Gateway",
	]);
}
