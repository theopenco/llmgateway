import { devpassOgImage, ogContentType, ogSize } from "@/lib/og";

export const alt = "DevPass supplemental Terms of Use";
export const size = ogSize;
export const contentType = ogContentType;

export default function TermsOgImage() {
	return devpassOgImage({
		eyebrow: "Legal",
		title: "DevPass Terms of Use",
		subtitle:
			"Supplemental terms for the flat-rate subscription: fair use, one account per developer, and approved coding tools.",
		path: "/legal/terms",
	});
}
