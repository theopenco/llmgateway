import { productOgImage } from "@/lib/home-og";
import { ogContentType, ogSize } from "@/lib/og";

export const size = ogSize;
export const contentType = ogContentType;
export const alt =
	"DevPass: flat-price plans for AI coding, with the usage dashboard";

export default function Image() {
	return productOgImage({
		gate: "C",
		audience: "Developers",
		title: "Flat-price plans",
		titleAccent: "for AI coding.",
		subtitle:
			"One key for your coding tools, included model usage, and every request tracked by tool in one dashboard.",
		screenshot: "devpass-usage-dark.webp",
		accent: "#6ee7b7",
		glow: "rgba(16,185,129,0.28)",
	});
}
