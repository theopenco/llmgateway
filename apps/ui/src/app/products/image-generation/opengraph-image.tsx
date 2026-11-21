import { productOgImage } from "@/lib/home-og";
import { ogContentType, ogSize } from "@/lib/og";

export const size = ogSize;
export const contentType = ogContentType;
export const alt =
	"LLM Gateway Image Generation API: every image model behind one OpenAI-compatible endpoint, priced per image";

export default function Image() {
	return productOgImage({
		gate: "E",
		audience: "Teams building with images",
		title: "Every image model,",
		titleAccent: "one API.",
		subtitle:
			"Generate and edit images through one OpenAI-compatible endpoint, at provider prices per image, with failover and cost on every request.",
		screenshot: "lounge-image-dark.webp",
		accent: "#fcd34d",
		glow: "rgba(245,158,11,0.28)",
	});
}
