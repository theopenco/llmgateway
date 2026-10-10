import { productOgImage } from "@/lib/home-og";
import { ogContentType, ogSize } from "@/lib/og";

export const size = ogSize;
export const contentType = ogContentType;
export const alt =
	"LLM Gateway Observability: cost, latency and errors on every request, with the activity log";

export default function Image() {
	return productOgImage({
		gate: "B",
		audience: "Platform & finance teams",
		title: "Every request,",
		titleAccent: "accounted for.",
		subtitle:
			"Cost, latency, errors and cache hits, with spend by model, provider and API key. Full prompts and responses with Enterprise data retention.",
		screenshot: "observability-activity-dark.webp",
		accent: "#c4b5fd",
		glow: "rgba(139,92,246,0.3)",
	});
}
