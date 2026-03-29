import Footer from "@/components/landing/footer";
import { HeroRSC } from "@/components/landing/hero-rsc";
import { TokenCostCalculatorClient } from "@/components/token-cost-calculator/token-cost-calculator-client";

import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "Token Cost Calculator | LLM Gateway",
	description:
		"Calculate your LLM token costs across models and providers. Compare official pricing vs LLM Gateway's cheapest provider rates with volume discounts.",
	openGraph: {
		title: "Token Cost Calculator | LLM Gateway",
		description:
			"Calculate your LLM token costs across models and providers. Compare official pricing vs LLM Gateway's cheapest provider rates with volume discounts.",
	},
};

export default function TokenCostCalculatorPage() {
	return (
		<div>
			<HeroRSC navbarOnly />
			<TokenCostCalculatorClient />
			<Footer />
		</div>
	);
}
