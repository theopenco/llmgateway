import { ogContentType, ogImage, ogSize } from "@/lib/og";

import { MARKETING_STATS } from "@llmgateway/shared";

export const size = ogSize;
export const contentType = ogContentType;
export const alt = "LLM Gateway — Open Source";

export default function Image() {
	return ogImage({
		eyebrow: "Open Source",
		title: "Self-Host Your AI Gateway",
		subtitle: `Open source under AGPLv3. Route ${MARKETING_STATS.models} models across ${MARKETING_STATS.providers} providers through one OpenAI-compatible endpoint.`,
	});
}
