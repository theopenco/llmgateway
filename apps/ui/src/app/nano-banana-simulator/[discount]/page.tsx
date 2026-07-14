import Footer from "@/components/landing/footer";
import { HeroRSC } from "@/components/landing/hero-rsc";
import { CostCalculator } from "@/components/nano-banana-simulator/cost-calculator";
import { PricingBreakdown } from "@/components/nano-banana-simulator/pricing-breakdown";
import { SimulatorCta } from "@/components/nano-banana-simulator/simulator-cta";
import { SimulatorHero } from "@/components/nano-banana-simulator/simulator-hero";

import type { Metadata } from "next";

interface PageProps {
	params: Promise<{ discount: string }>;
}

function parseDiscount(value: string): number {
	const parsed = Number(value);
	if (isNaN(parsed) || parsed < 1 || parsed > 99) {
		return 20;
	}
	return Math.round(parsed);
}

export async function generateMetadata({
	params,
}: PageProps): Promise<Metadata> {
	const { discount: raw } = await params;
	const discount = parseDiscount(raw);

	return {
		title: "Nano Banana Pro Cost Simulator",
		description: `See how much you save on Gemini 3 Pro image generation with LLM Gateway. ${discount}% savings vs Google AI Studio pricing.`,
		// All discount variants (1-99) render near-identical content, so they
		// consolidate onto the default /20 page (the one the sitemap submits)
		// instead of each declaring itself canonical.
		alternates: {
			canonical: "/nano-banana-simulator/20",
		},
		openGraph: {
			title: "Nano Banana Pro Cost Simulator | LLM Gateway",
			description: `See how much you save on Gemini 3 Pro image generation. ${discount}% savings vs Google AI Studio pricing.`,
			url: `https://llmgateway.io/nano-banana-simulator/${discount}`,
			type: "website",
		},
	};
}

export default async function NanoBananaSimulatorPage({ params }: PageProps) {
	const { discount: raw } = await params;
	const discount = parseDiscount(raw);

	return (
		<>
			<HeroRSC navbarOnly />
			<SimulatorHero discount={discount} />
			<CostCalculator discount={discount} />
			<PricingBreakdown discount={discount} />
			<SimulatorCta discount={discount} />
			<Footer />
		</>
	);
}
