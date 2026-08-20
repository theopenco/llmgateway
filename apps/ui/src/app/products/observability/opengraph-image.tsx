import { ogContentType, ogImage, ogSize } from "@/lib/og";

export const size = ogSize;
export const contentType = ogContentType;
export const alt = "LLM Gateway — Observability";

export default function Image() {
	return ogImage({
		eyebrow: "Observability",
		title: "See Every LLM Request",
		subtitle:
			"Real-time cost analytics, per-model and per-provider breakdowns, error and cache rates, latency, and full request logs.",
	});
}
