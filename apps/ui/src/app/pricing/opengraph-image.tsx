import { ogContentType, ogImage, ogSize } from "@/lib/og";

import { MARKETING_STATS } from "@llmgateway/shared";

export const size = ogSize;
export const contentType = ogContentType;
export const alt = "LLM Gateway — Pricing";

export default function Image() {
	return ogImage({
		eyebrow: "Pricing",
		title: "Provider Rates. One Bill.",
		subtitle: `Pay per-token at provider rates with a flat ${MARKETING_STATS.platformFee} platform fee on credits — or free with your own keys across ${MARKETING_STATS.providers} providers.`,
	});
}
