import { ogContentType, ogImage, ogSize } from "@/lib/og";

export const size = ogSize;
export const contentType = ogContentType;
export const alt = "LLM Gateway — Apps";

export default function Image() {
	return ogImage({
		eyebrow: "Apps",
		title: "Apps Using LLM Gateway",
		subtitle:
			"Coding agents and tools ranked by real token volume — Claude Code, Cursor, Cline, OpenCode, Aider, and more.",
	});
}
