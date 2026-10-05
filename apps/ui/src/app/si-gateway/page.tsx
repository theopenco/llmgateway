import Footer from "@/components/landing/footer";
import { HeroRSC } from "@/components/landing/hero-rsc";
import {
	SiCta,
	SiGatewayFeatures,
	SiGatewayHero,
	SiGatewayStats,
} from "@/components/super-intelligence/si-gateway";
import { PageViewTracker } from "@/components/super-intelligence/tracking";

import type { Metadata } from "next";

const description =
	"SI Gateway: one OpenAI-compatible API for every Super Intelligence (SI) model, with routing, failover, cost tracking and audit-ready logs.";

export const metadata: Metadata = {
	title: "SI Gateway – One API for Every Super Intelligence Model",
	description,
	alternates: { canonical: "/si-gateway" },
	openGraph: {
		title: "SI Gateway | LLM Gateway",
		description,
		url: "https://llmgateway.io/si-gateway",
		type: "website",
	},
	twitter: {
		card: "summary_large_image",
		title: "SI Gateway | LLM Gateway",
		description,
	},
};

export default function SiGatewayPage() {
	return (
		<div>
			<PageViewTracker event="page_viewed_si_gateway" />
			<HeroRSC />
			<SiGatewayHero />
			<SiGatewayStats />
			<SiGatewayFeatures />
			<SiCta
				location="si_gateway_cta"
				title="AI is now SI. Your stack can stay simple."
				body="Point your base URL at LLM Gateway and reach every Super Intelligence provider with one key, one bill and one log."
			/>
			<Footer />
		</div>
	);
}
