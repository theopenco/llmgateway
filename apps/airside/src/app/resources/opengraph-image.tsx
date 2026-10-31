import { airsideOgImage, ogContentType, ogSize } from "@/lib/og";

export const alt = "Airside provider guides and free tools";
export const size = ogSize;
export const contentType = ogContentType;

export default function ResourcesOgImage() {
	return airsideOgImage({
		eyebrow: "Provider resources",
		title: "LLM provider guides and free tools",
		subtitle:
			"Prepare your API for listing, plan inference pricing and check request capacity.",
	});
}
