import { devpassOgImage, ogContentType, ogSize } from "@/lib/og";

export const alt = "DevPass setup guides for coding agents";
export const size = ogSize;
export const contentType = ogContentType;

export default function GuidesOgImage() {
	return devpassOgImage({
		eyebrow: "Guides",
		title: "Plug DevPass into your coding agent",
		subtitle:
			"Step-by-step setup for Claude Code, OpenCode, Cursor, Cline, and every OpenAI-compatible tool.",
		path: "/guides",
	});
}
