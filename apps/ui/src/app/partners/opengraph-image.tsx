import { ogContentType, ogImage, ogSize } from "@/lib/og";

export const size = ogSize;
export const contentType = ogContentType;
export const alt =
	"LLM Gateway Partners — the infrastructure behind the gateway";

export default function Image() {
	return ogImage({
		eyebrow: "Partners",
		title: "The Infrastructure Behind the Gateway",
		subtitle:
			"Meet the inference partners powering LLM Gateway — starting with SCX.ai, serving open models from Sydney, Australia.",
	});
}
