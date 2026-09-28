import { homeOgImage } from "@/lib/home-og";
import { ogContentType, ogSize } from "@/lib/og";

export const size = ogSize;
export const contentType = ogContentType;
export const alt =
	"LLM Gateway: company-wide AI, live in weeks, not quarters. Start a 30-day production pilot.";

export default function Image() {
	return homeOgImage();
}
