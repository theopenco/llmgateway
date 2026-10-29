import { homeOgImage } from "@/lib/home-og";
import { ogContentType, ogSize } from "@/lib/og";

export const size = ogSize;
export const contentType = ogContentType;
export const alt = "LLM Gateway";

export default function Image() {
	return homeOgImage();
}
