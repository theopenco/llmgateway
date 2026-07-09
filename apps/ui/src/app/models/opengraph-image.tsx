import { ogContentType, ogImage, ogSize } from "@/lib/og";

export const size = ogSize;
export const contentType = ogContentType;
export const alt = "LLM Gateway — The AI Model Directory";

export default function Image() {
	return ogImage({
		eyebrow: "Models",
		title: "The AI Model Directory",
		subtitle:
			"Compare 200+ models from OpenAI, Anthropic, Google, and 40+ providers — by price, speed, and capability.",
	});
}
