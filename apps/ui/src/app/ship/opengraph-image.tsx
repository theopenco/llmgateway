import { ogContentType, ogImage, ogSize } from "@/lib/og";

export const size = ogSize;
export const contentType = ogContentType;
export const alt = "LLM Gateway — Ship an AI app in 10 minutes";

export default function Image() {
	return ogImage({
		eyebrow: "Ship",
		title: "Ship an AI App in 10 Minutes",
		subtitle:
			"Production-ready starters and one API key for every model. Go from idea to deployed — fast.",
	});
}
