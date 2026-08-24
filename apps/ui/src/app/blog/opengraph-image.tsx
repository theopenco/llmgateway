import { ogContentType, ogImage, ogSize } from "@/lib/og";

export const size = ogSize;
export const contentType = ogContentType;
export const alt = "LLM Gateway — Blog";

export default function Image() {
	return ogImage({
		eyebrow: "Blog",
		title: "News, Tutorials & Deep-Dives",
		subtitle:
			"From the LLM Gateway team: AI gateways, model routing, LLM costs, model comparisons, and shipping production AI apps.",
	});
}
