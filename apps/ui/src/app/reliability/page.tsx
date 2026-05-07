import { UptimeVisualization } from "@/components/enterprise/uptime";
import Footer from "@/components/landing/footer";
import { HeroRSC } from "@/components/landing/hero-rsc";
import { ReliabilityCTA } from "@/components/reliability/cta";
import { ReliabilityFailover } from "@/components/reliability/failover";
import { ReliabilityFeatures } from "@/components/reliability/features";
import { ReliabilityHero } from "@/components/reliability/hero";

import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "Reliability & 99.9999% Uptime",
	description:
		"Automatic failover across providers, real-time health monitoring, and intelligent routing. Never go down, even when your providers do.",
	openGraph: {
		title: "Reliability & 99.9999% Uptime — LLM Gateway",
		description:
			"Automatic failover across providers, real-time health monitoring, and intelligent routing. Never go down, even when your providers do.",
	},
};

export default function ReliabilityPage() {
	return (
		<div>
			<HeroRSC navbarOnly />
			<ReliabilityHero />
			<UptimeVisualization />
			<ReliabilityFailover />
			<ReliabilityFeatures />
			<ReliabilityCTA />
			<Footer />
		</div>
	);
}
