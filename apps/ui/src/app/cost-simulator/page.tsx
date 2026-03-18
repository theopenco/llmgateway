import { CostSimulatorClient } from "@/components/cost-simulator/cost-simulator-client";
import Footer from "@/components/landing/footer";
import { HeroRSC } from "@/components/landing/hero-rsc";

import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "LLM Cost Simulator | LLM Gateway",
	description:
		"Calculate exactly how much your team can save on LLM costs. Compare models, providers, and use cases with our interactive cost simulator.",
	openGraph: {
		title: "LLM Cost Simulator | LLM Gateway",
		description:
			"Calculate exactly how much your team can save on LLM costs. Compare models, providers, and use cases with our interactive cost simulator.",
	},
};

export default function CostSimulatorPage() {
	return (
		<div>
			<HeroRSC navbarOnly />
			<CostSimulatorClient />
			<Footer />
		</div>
	);
}
