import { ogContentType, ogImage, ogSize } from "@/lib/og";

export const size = ogSize;
export const contentType = ogContentType;
export const alt = "LLM Gateway — Legal";

export default function Image() {
	return ogImage({
		eyebrow: "Legal",
		title: "Legal & Policies",
		subtitle:
			"Terms of Use, Privacy Policy, sub-processors, and AI provider legal and compliance information.",
	});
}
