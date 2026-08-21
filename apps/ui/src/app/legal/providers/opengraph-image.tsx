import { ogContentType, ogImage, ogSize } from "@/lib/og";

export const size = ogSize;
export const contentType = ogContentType;
export const alt = "LLM Gateway — AI Provider Legal Information";

export default function Image() {
	return ogImage({
		eyebrow: "Legal",
		title: "AI Provider Legal Info",
		subtitle:
			"Privacy, data retention, training, location, and compliance details for every provider on LLM Gateway.",
	});
}
