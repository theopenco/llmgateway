import { ogContentType, ogImage, ogSize } from "@/lib/og";

import { MARKETING_STATS } from "@llmgateway/shared";

export const size = ogSize;
export const contentType = ogContentType;
export const alt = "LLM Gateway — Token Cost Calculator";

export default function Image() {
	return ogImage({
		eyebrow: "Free Tool",
		title: "LLM Token Cost Calculator",
		subtitle: `Count tokens with a real tokenizer, then compare the same workload on GPT-5, Claude, Gemini, and ${MARKETING_STATS.models} models.`,
	});
}
