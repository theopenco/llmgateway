import { ogContentType, ogImage, ogSize } from "@/lib/og";

export const size = ogSize;
export const contentType = ogContentType;
export const alt = "LLM Gateway — Brand Assets";

export default function Image() {
	return ogImage({
		eyebrow: "Brand",
		title: "Brand Assets",
		subtitle:
			"Official LLM Gateway logos, marks, and usage guidelines — SVG files in light and dark variants.",
	});
}
