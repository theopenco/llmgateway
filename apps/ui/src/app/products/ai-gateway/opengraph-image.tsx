import { ogContentType, ogImage, ogSize } from "@/lib/og";

import { MARKETING_STATS } from "@llmgateway/shared";

export const size = ogSize;
export const contentType = ogContentType;
export const alt = "LLM Gateway — AI Gateway";

export default function Image() {
	return ogImage({
		eyebrow: "AI Gateway",
		title: "One API for Every LLM",
		subtitle: `Route ${MARKETING_STATS.models} models across ${MARKETING_STATS.providers} providers with smart routing, automatic fallback, caching, and guardrails.`,
	});
}
