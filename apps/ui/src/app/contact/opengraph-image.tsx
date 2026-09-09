import { ogContentType, ogImage, ogSize } from "@/lib/og";

export const size = ogSize;
export const contentType = ogContentType;
export const alt = "Contact the LLM Gateway team";

export default function Image() {
	return ogImage({
		eyebrow: "Contact",
		title: "Talk to the LLM Gateway Team",
		subtitle:
			"Email support, the Discord community, GitHub issues, and enterprise sales — pick the channel that fits.",
	});
}
