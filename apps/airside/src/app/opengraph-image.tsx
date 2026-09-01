import { airsideOgImage, ogContentType, ogSize } from "@/lib/og";

export const alt = "Airside by LLM Gateway — the carrier console";
export const size = ogSize;
export const contentType = ogContentType;

export default function AirsideOgImage() {
	return airsideOgImage({
		eyebrow: "The carrier console",
		title: "Put your models on the departure board.",
		subtitle:
			"Claim your carrier, register your fleet, file your fares — and win routes.",
	});
}
