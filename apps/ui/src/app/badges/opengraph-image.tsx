import { ogContentType, ogImage, ogSize } from "@/lib/og";

export const size = ogSize;
export const contentType = ogContentType;
export const alt = "LLM Gateway — Live status and pricing badges";

export default function Image() {
	return ogImage({
		eyebrow: "Free Tool",
		title: "Live LLM Status & Pricing Badges",
		subtitle:
			"Embed measured provider uptime and current model prices in any README or website.",
	});
}
