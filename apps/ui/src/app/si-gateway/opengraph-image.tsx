import { ogContentType, ogImage, ogSize } from "@/lib/og";

import { MARKETING_STATS } from "@llmgateway/shared";

export const size = ogSize;
export const contentType = ogContentType;
export const alt = "LLM Gateway — SI Gateway";

export default function Image() {
	return ogImage({
		eyebrow: "SI Gateway",
		title: "One API for Every Super Intelligence Model",
		subtitle: `${MARKETING_STATS.models} models from ${MARKETING_STATS.providers} providers, with routing, failover and cost tracking built in.`,
	});
}
