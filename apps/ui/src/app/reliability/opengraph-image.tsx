import { ogContentType, ogImage, ogSize } from "@/lib/og";

import { MARKETING_STATS } from "@llmgateway/shared";

export const size = ogSize;
export const contentType = ogContentType;
export const alt = "LLM Gateway — Reliability";

export default function Image() {
	return ogImage({
		eyebrow: "Reliability",
		title: `${MARKETING_STATS.effectiveUptime} Effective Uptime`,
		subtitle:
			"Automatic failover across providers, real-time health monitoring, and intelligent routing. Never go down, even when your providers do.",
	});
}
