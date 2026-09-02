import { airsideOgImage, ogContentType, ogSize } from "@/lib/og";

export const alt = "Airside Supplemental Privacy Notice";
export const size = ogSize;
export const contentType = ogContentType;

export default function PrivacyOgImage() {
	return airsideOgImage({
		eyebrow: "Legal",
		title: "Airside Supplemental Privacy Notice",
		subtitle:
			"What Airside collects from carriers, why, and how long it is kept.",
		board: [
			{ flight: "CLAIMS", carrier: "COMPANY EMAIL", status: "VERIFIED" },
			{ flight: "TRAFFIC", carrier: "AGGREGATED", status: "NO TENANTS" },
			{ flight: "PROMPTS", carrier: "NEVER SHOWN", status: "SEALED" },
		],
	});
}
