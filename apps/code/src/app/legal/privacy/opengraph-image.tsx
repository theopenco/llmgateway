import { devpassOgImage, ogContentType, ogSize } from "@/lib/og";

export const alt = "DevPass supplemental Privacy Policy";
export const size = ogSize;
export const contentType = ogContentType;

export default function PrivacyOgImage() {
	return devpassOgImage({
		eyebrow: "Legal",
		title: "DevPass Privacy Policy",
		subtitle:
			"How DevPass handles request retention, per-agent metadata, AI provider routing, and sub-processors.",
		path: "/legal/privacy",
	});
}
