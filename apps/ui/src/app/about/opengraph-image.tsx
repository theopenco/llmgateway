import { ogContentType, ogImage, ogSize } from "@/lib/og";

export const size = ogSize;
export const contentType = ogContentType;
export const alt = "About LLM Gateway — who builds it and why";

export default function Image() {
	return ogImage({
		eyebrow: "About",
		title: "Who Builds LLM Gateway, and Why",
		subtitle:
			"An open-source LLM API gateway routing requests across 40+ providers through one OpenAI-compatible API.",
	});
}
