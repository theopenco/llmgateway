import { loungeOgImage, ogContentType, ogSize } from "@/lib/og";

import { CHAT_PLAN_PRICES } from "@llmgateway/shared";

export const alt = "Lounge membership pricing";
export const size = ogSize;
export const contentType = ogContentType;

export default function PricingOgImage() {
	return loungeOgImage({
		eyebrow: "Pricing",
		title: "Every frontier model. One membership.",
		subtitle: `Claude Opus, GPT-5, Gemini, and Grok from $${CHAT_PLAN_PRICES.plus}/mo — start on fast models from $${CHAT_PLAN_PRICES.starter}/mo.`,
		path: "/pricing",
	});
}
