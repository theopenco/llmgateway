import Footer from "@/components/landing/footer";
import { HeroRSC } from "@/components/landing/hero-rsc";
import { PricingHero } from "@/components/pricing/pricing-hero";
import { PricingTable } from "@/components/pricing/pricing-table";
import { JsonLd } from "@/components/seo/json-ld";

import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "LLM API Pricing — Provider Rates, Free BYOK",
	description:
		"Pay per-token at provider rates with a flat 5% platform fee on credits — or free with your own keys (BYOK). Volume discounts and one bill across 40+ providers.",
	alternates: { canonical: "/pricing" },
	openGraph: {
		title: "LLM API Pricing — Provider Rates, Free BYOK",
		description:
			"Pay per-token at provider rates with a flat 5% platform fee on credits, or free with your own keys. One bill across 40+ LLM providers.",
		type: "website",
		url: "https://llmgateway.io/pricing",
	},
	twitter: {
		card: "summary_large_image",
		title: "LLM API Pricing — Provider Rates, Free BYOK",
		description:
			"Pay per-token at provider rates with a flat 5% platform fee on credits, or free with your own keys. One bill across 40+ LLM providers.",
	},
};

const pricingSchema = {
	"@context": "https://schema.org",
	"@type": "Product",
	name: "LLM Gateway API",
	description:
		"Unified API for 200+ LLM models across 40+ providers. Pay per-token at provider rates with a flat 5% platform fee on credits, bring your own keys for free, or self-host under AGPLv3.",
	brand: {
		"@type": "Brand",
		name: "LLM Gateway",
	},
	url: "https://llmgateway.io/pricing",
	offers: {
		"@type": "AggregateOffer",
		priceCurrency: "USD",
		lowPrice: "0",
		offerCount: 2,
		offers: [
			{
				"@type": "Offer",
				name: "Free",
				price: "0",
				priceCurrency: "USD",
				description:
					"Access all 200+ models with a flat 5% platform fee on credit purchases, or bring your own provider keys for free.",
				url: "https://llmgateway.io/pricing",
			},
			{
				"@type": "Offer",
				name: "Enterprise",
				priceCurrency: "USD",
				description:
					"Volume discounts, custom routing, unlimited data retention, and a 99.9% uptime SLA.",
				url: "https://llmgateway.io/enterprise",
			},
		],
	},
};

const breadcrumbSchema = {
	"@context": "https://schema.org",
	"@type": "BreadcrumbList",
	itemListElement: [
		{
			"@type": "ListItem",
			position: 1,
			name: "Home",
			item: "https://llmgateway.io",
		},
		{
			"@type": "ListItem",
			position: 2,
			name: "Pricing",
			item: "https://llmgateway.io/pricing",
		},
	],
};

export default function PricingPage() {
	return (
		<>
			<JsonLd data={[pricingSchema, breadcrumbSchema]} />
			<HeroRSC navbarOnly />
			<PricingHero />
			<PricingTable />
			<Footer />
		</>
	);
}
