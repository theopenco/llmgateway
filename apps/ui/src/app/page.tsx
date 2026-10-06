import dynamic from "next/dynamic";

import { HeroRSC } from "@/components/landing/hero-rsc";
import { LandingHero } from "@/components/landing/landing-hero";

import { allMigrations } from "content-collections";

const TrustBar = dynamic(() =>
	import("@/components/enterprise/trust-bar").then(
		(mod) => mod.TrustBarEnterprise,
	),
);
const Features = dynamic(() => import("@/components/landing/features"));
const ControlPlane = dynamic(() =>
	import("@/components/home/control-plane").then((mod) => mod.ControlPlane),
);
const ProductFamily = dynamic(() =>
	import("@/components/home/product-family").then((mod) => mod.ProductFamily),
);
const Graph = dynamic(() =>
	import("@/components/landing/graph").then((mod) => mod.Graph),
);
const DeveloperLane = dynamic(() =>
	import("@/components/home/developer-lane").then((mod) => mod.DeveloperLane),
);
const Uptime = dynamic(() =>
	import("@/components/enterprise/uptime").then(
		(mod) => mod.UptimeVisualization,
	),
);
const Testimonials = dynamic(() =>
	import("@/components/landing/testimonials").then((mod) => mod.Testimonials),
);
const Faq = dynamic(() =>
	import("@/components/landing/faq").then((mod) => mod.Faq),
);
const EnterpriseCTA = dynamic(() =>
	import("@/components/landing/enterprise-cta").then(
		(mod) => mod.EnterpriseCTA,
	),
);
const CallToAction = dynamic(() => import("@/components/landing/cta"));
const Footer = dynamic(() => import("@/components/landing/footer"));

const HIDDEN_MIGRATIONS = new Set(["vercel-ai-gateway", "portkey"]);

export default function Home() {
	const migrations = allMigrations
		.filter((m) => !HIDDEN_MIGRATIONS.has(m.slug))
		.map((m) => ({ slug: m.slug, fromProvider: m.fromProvider }));

	return (
		<>
			<HeroRSC />
			<main>
				<LandingHero />
				<TrustBar />
				<Features />
				<ControlPlane />
				<ProductFamily />
				<Graph />
				<DeveloperLane migrations={migrations} />
				<Uptime />
				<Testimonials />
				<Faq />
				<EnterpriseCTA />
				<CallToAction />
			</main>
			<Footer />
		</>
	);
}
