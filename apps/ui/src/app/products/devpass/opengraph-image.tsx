import { ogContentType, ogImage, ogSize } from "@/lib/og";

export const size = ogSize;
export const contentType = ogContentType;
export const alt = "LLM Gateway — DevPass";

export default function Image() {
	return ogImage({
		eyebrow: "DevPass",
		title: "Flat-Price Dev Plans",
		subtitle:
			"Every dollar becomes $3 of model usage at provider rates — for Claude Code, Cursor, Cline, and any OpenAI-compatible coding tool.",
	});
}
