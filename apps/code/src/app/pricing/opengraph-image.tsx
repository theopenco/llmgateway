import { devpassOgImage, ogContentType, ogSize } from "@/lib/og";

import { DEV_PLAN_PRICES } from "@llmgateway/shared";

export const alt = "DevPass pricing — flat-rate AI coding plans";
export const size = ogSize;
export const contentType = ogContentType;

export default function PricingOgImage() {
	return devpassOgImage({
		eyebrow: "Pricing",
		title: "Flat rate. Every model. No token math.",
		subtitle: `Lite, Pro, and Max from $${DEV_PLAN_PRICES.lite}/month — 200+ coding models metered at provider rates, in any coding agent.`,
		path: "/pricing",
	});
}
