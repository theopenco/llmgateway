import { ogContentType, ogImage, ogSize } from "@/lib/og";

import { MARKETING_STATS } from "@llmgateway/shared";

export const size = ogSize;
export const contentType = ogContentType;
export const alt = "LLM Gateway — Use Cases";

export default function Image() {
	return ogImage({
		eyebrow: "Use Cases",
		title: "What You Can Build",
		subtitle: `Coding agents, AI support, RAG, and cost optimization — one API for ${MARKETING_STATS.models} models with fallback, caching, and analytics.`,
	});
}
