import { ogContentType, ogImage, ogSize } from "@/lib/og";

export const size = ogSize;
export const contentType = ogContentType;
export const alt = "LLM Gateway — List Your AI Provider";

export default function Image() {
	return ogImage({
		eyebrow: "Providers",
		title: "List Your AI Provider",
		subtitle:
			"Get your models in front of developers on LLM Gateway — share your details and our team will get in touch.",
	});
}
