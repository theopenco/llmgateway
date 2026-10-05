import { ogContentType, ogImage, ogSize } from "@/lib/og";

export const size = ogSize;
export const contentType = ogContentType;
export const alt = "LLM Gateway — Super Intelligence explained";

export default function Image() {
	return ogImage({
		eyebrow: "Super Intelligence",
		title: "AI Is Now SI, Explained",
		subtitle:
			"What Executive Order 14434 changes, what it does not, and what it means for teams building with models.",
	});
}
