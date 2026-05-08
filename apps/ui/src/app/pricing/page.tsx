import Footer from "@/components/landing/footer";
import { HeroRSC } from "@/components/landing/hero-rsc";
import { PricingHero } from "@/components/pricing/pricing-hero";
import { PricingTable } from "@/components/pricing/pricing-table";

import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "LLM API Pricing — Per-Token, No Markup",
	description:
		"Pay per-token at provider rates with no markup. Free tier included, volume discounts on paid plans, and one bill across OpenAI, Anthropic, Google, and 30+ providers.",
	openGraph: {
		title: "LLM API Pricing — Per-Token, No Markup",
		description:
			"Pay per-token at provider rates with no markup. Free tier included, volume discounts on paid plans, and one bill across OpenAI, Anthropic, Google, and 30+ providers.",
		type: "website",
	},
	twitter: {
		card: "summary_large_image",
		title: "LLM API Pricing — Per-Token, No Markup",
		description:
			"Pay per-token at provider rates with no markup. Free tier included, volume discounts on paid plans, and one bill across 30+ LLM providers.",
	},
};

export default function PricingPage() {
	return (
		<>
			<HeroRSC navbarOnly />
			<PricingHero />
			<PricingTable />
			<Footer />
		</>
	);
}
