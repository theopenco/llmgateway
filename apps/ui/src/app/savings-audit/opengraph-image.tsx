import { ogContentType, ogImage, ogSize } from "@/lib/og";

export const size = ogSize;
export const contentType = ogContentType;
export const alt = "LLM Gateway — LLM Savings Audit";

export default function Image() {
	return ogImage({
		eyebrow: "Free Tool",
		title: "LLM Savings Audit",
		subtitle:
			"Drop in a usage export and see what the same tokens cost at the cheapest provider for each model.",
	});
}
