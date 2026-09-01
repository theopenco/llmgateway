import { devpassOgImage, ogContentType, ogSize } from "@/lib/og";

import { MARKETING_STATS } from "@llmgateway/shared";

export const alt = "Coding models on DevPass — full directory";
export const size = ogSize;
export const contentType = ogContentType;

export default function ModelsOgImage() {
	return devpassOgImage({
		eyebrow: "Models",
		title: "Every coding model, one key",
		subtitle: `Browse ${MARKETING_STATS.models} models — filter by tier, capabilities, provider, price, and context size.`,
		path: "/models",
	});
}
