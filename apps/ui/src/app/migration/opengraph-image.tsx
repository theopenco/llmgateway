import { ogContentType, ogImage, ogSize } from "@/lib/og";

export const size = ogSize;
export const contentType = ogContentType;
export const alt = "LLM Gateway — Migration Guides";

export default function Image() {
	return ogImage({
		eyebrow: "Migration Guides",
		title: "Switch to LLM Gateway",
		subtitle:
			"Step-by-step guides to migrate from GitHub Copilot, OpenRouter, Vercel AI Gateway, LiteLLM, Portkey, and more.",
	});
}
