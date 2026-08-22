import { ogContentType, ogImage, ogSize } from "@/lib/og";

export const size = ogSize;
export const contentType = ogContentType;
export const alt = "LLM Gateway — Compare AI Models";

export default function Image() {
	return ogImage({
		eyebrow: "Models",
		title: "Compare Models Side by Side",
		subtitle:
			"Pick any two AI models to compare pricing, context window, and capabilities.",
	});
}
