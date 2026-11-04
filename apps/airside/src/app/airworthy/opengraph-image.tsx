import { airsideOgImage, ogContentType, ogSize } from "@/lib/og";

export const alt = "Airworthy: the certificate for LLM inference providers";
export const size = ogSize;
export const contentType = ogContentType;

export default function AirworthyOgImage() {
	return airsideOgImage({
		eyebrow: "Standard AW-1 · Airworthy",
		title: "Self-declared isn't verified.",
		subtitle:
			"The certificate that proves an inference provider's claims on training, retention, headquarters and audits.",
		board: [
			{ flight: "AW-1.D", carrier: "DATA HANDLING", status: "INSPECTED" },
			{ flight: "AW-1.J", carrier: "JURISDICTION", status: "INSPECTED" },
			{ flight: "AW-1.A", carrier: "ASSURANCE", status: "INSPECTED" },
		],
	});
}
