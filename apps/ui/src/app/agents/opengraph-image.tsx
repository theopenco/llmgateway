import { ogContentType, ogImage, ogSize } from "@/lib/og";

export const size = ogSize;
export const contentType = ogContentType;
export const alt = "LLM Gateway — Pre-built AI agents";

export default function Image() {
	return ogImage({
		eyebrow: "Agents",
		title: "Pre-Built AI Agents",
		subtitle:
			"Tool-calling agents ready to deploy on any model, through one unified API.",
	});
}
