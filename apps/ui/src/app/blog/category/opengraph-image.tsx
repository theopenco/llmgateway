import { ogContentType, ogImage, ogSize } from "@/lib/og";

export const size = ogSize;
export const contentType = ogContentType;
export const alt = "LLM Gateway — Blog Categories";

export default function Image() {
	return ogImage({
		eyebrow: "Blog",
		title: "Browse by Category",
		subtitle:
			"LLM Gateway blog posts by category — product updates, tutorials, deep-dives, and more.",
	});
}
