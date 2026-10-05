import Footer from "@/components/landing/footer";
import { HeroRSC } from "@/components/landing/hero-rsc";
import { SiCta } from "@/components/super-intelligence/si-gateway";
import {
	SuperIntelligenceChanges,
	SuperIntelligenceFacts,
	SuperIntelligenceFaq,
	SuperIntelligenceGatewayPitch,
	SuperIntelligenceHero,
} from "@/components/super-intelligence/super-intelligence";
import { PageViewTracker } from "@/components/super-intelligence/tracking";

import type { Metadata } from "next";

const description =
	"Executive Order 14434 replaces Artificial Intelligence (AI) with Super Intelligence (SI) across the US executive branch. What it covers, what it does not, and what it means for developers.";

export const metadata: Metadata = {
	title: "Super Intelligence (SI) Explained – AI Renamed by Executive Order",
	description,
	alternates: { canonical: "/super-intelligence" },
	openGraph: {
		title: "Super Intelligence (SI) Explained | LLM Gateway",
		description,
		url: "https://llmgateway.io/super-intelligence",
		type: "website",
	},
	twitter: {
		card: "summary_large_image",
		title: "Super Intelligence (SI) Explained",
		description,
	},
};

export default function SuperIntelligencePage() {
	return (
		<div>
			<PageViewTracker event="page_viewed_super_intelligence" />
			<HeroRSC />
			<SuperIntelligenceHero />
			<SuperIntelligenceFacts />
			<SuperIntelligenceChanges />
			<SuperIntelligenceGatewayPitch />
			<SuperIntelligenceFaq />
			<SiCta
				location="super_intelligence_cta"
				title="Ship with Super Intelligence today"
				body="One OpenAI-compatible API for every SI provider, with failover, cost tracking and logs built in."
			/>
			<Footer />
		</div>
	);
}
