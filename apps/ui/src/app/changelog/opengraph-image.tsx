import { ogContentType, ogImage, ogSize } from "@/lib/og";

export const size = ogSize;
export const contentType = ogContentType;
export const alt = "LLM Gateway — Changelog";

export default function Image() {
	return ogImage({
		eyebrow: "Changelog",
		title: "What's New in LLM Gateway",
		subtitle:
			"The latest features, improvements, and fixes across the gateway, dashboard, and APIs.",
	});
}
