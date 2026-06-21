import { ogContentType, ogImage, ogSize } from "@/lib/og";

export const size = ogSize;
export const contentType = ogContentType;
export const alt = "LLM Gateway — Every LLM provider behind one API";

export default function Image() {
	return ogImage({
		eyebrow: "Providers",
		title: "Every LLM Provider, One API",
		subtitle:
			"OpenAI, Anthropic, Google, Groq, Mistral, DeepSeek, xAI, and 40+ more — unified behind a single endpoint.",
	});
}
