import { airsideOgImage, ogContentType, ogSize } from "@/lib/og";

export const alt = "Airside Supplemental Terms of Use";
export const size = ogSize;
export const contentType = ogContentType;

export default function TermsOgImage() {
	return airsideOgImage({
		eyebrow: "Legal",
		title: "Airside Supplemental Terms of Use",
		subtitle:
			"The terms that govern listing your models as a carrier on LLM Gateway.",
		board: [
			{ flight: "CLAIMS", carrier: "DOMAIN VERIFIED", status: "REQUIRED" },
			{ flight: "TARIFFS", carrier: "PRICE FILINGS", status: "REVIEWED" },
			{ flight: "DISPATCH", carrier: "ROUTING", status: "SCORED" },
		],
	});
}
