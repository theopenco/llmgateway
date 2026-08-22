import { ogContentType, ogImage, ogSize } from "@/lib/og";

export const size = ogSize;
export const contentType = ogContentType;
export const alt = "LLM Gateway — GitHub Copilot Cost Calculator";

export default function Image() {
	return ogImage({
		eyebrow: "Free Tool",
		title: "Copilot Cost Calculator",
		subtitle:
			"Estimate your team's monthly GitHub Copilot AI-credits bill and compare the same workload at pass-through token prices.",
	});
}
