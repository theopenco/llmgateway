import { homeOgImage } from "@/lib/home-og";
import { ogContentType, ogSize } from "@/lib/og";

import { MARKETING_STATS } from "@llmgateway/shared";

export const size = ogSize;
export const contentType = ogContentType;
export const alt = `LLM Gateway: one open-source API for ${MARKETING_STATS.providers} providers, including OpenAI, Anthropic and Google. Route ${MARKETING_STATS.models} models and switch providers without changing your code.`;

export default function Image() {
	return homeOgImage();
}
