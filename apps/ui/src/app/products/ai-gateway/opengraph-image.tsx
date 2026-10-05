import { productOgImage } from "@/lib/home-og";
import { ogContentType, ogSize } from "@/lib/og";

import { MARKETING_STATS } from "@llmgateway/shared";

export const size = ogSize;
export const contentType = ogContentType;
export const alt =
	"LLM Gateway AI Gateway: one OpenAI-compatible API with the API keys dashboard";

export default function Image() {
	return productOgImage({
		gate: "A",
		audience: "Product & platform teams",
		title: "One API.",
		titleAccent: `${MARKETING_STATS.models} models.`,
		subtitle:
			"OpenAI-compatible routing, caching, failover and cost analytics on every request. Guardrails on Enterprise.",
		screenshot: "gateway-api-keys-dark.webp",
		accent: "#7dd3fc",
		glow: "rgba(56,189,248,0.3)",
	});
}
