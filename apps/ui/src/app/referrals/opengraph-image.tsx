import { ogContentType, ogImage, ogSize } from "@/lib/og";

export const size = ogSize;
export const contentType = ogContentType;
export const alt = "LLM Gateway — Referral Program";

export default function Image() {
	return ogImage({
		eyebrow: "Referrals",
		title: "Earn 1% of Referred Spend",
		subtitle:
			"Refer developers to LLM Gateway and earn 1% of their LLM spending as credits, added directly to your balance.",
	});
}
