import dynamic from "next/dynamic";
import { Suspense } from "react";

import { HeroRSC } from "@/components/landing/hero-rsc";
import { LandingHero } from "@/components/landing/landing-hero";
import {
	Testimonials,
	TestimonialsFallback,
} from "@/components/landing/testimonials";

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

	// Each Suspense boundary hydrates on its own at low priority once the hero
	// is interactive, so below-the-fold sections no longer add to one long
	// hydration task. A section that suspends needs a fallback with the same
	// layout (see Testimonials) so it never streams in empty.
	return (
		<>
			<HeroRSC />
			<main>
				<LandingHero />
				<Suspense>
					<TrustBar />
				</Suspense>
				<Suspense>
					<Features />
				</Suspense>
				<Suspense>
					<ControlPlane />
				</Suspense>
				<Suspense>
					<ProductFamily />
				</Suspense>
				<Suspense>
					<Graph />
				</Suspense>
				<Suspense>
					<DeveloperLane migrations={migrations} />
				</Suspense>
				<Suspense>
					<Uptime showEyebrow={false} />
				</Suspense>
				<Suspense fallback={<TestimonialsFallback />}>
					<Testimonials />
				</Suspense>
				<Suspense>
					<Faq />
				</Suspense>
				<Suspense>
					<EnterpriseCTA />
				</Suspense>
				<Suspense>
					<CallToAction />
				</Suspense>
			</main>
			<Suspense>
				<Footer />
			</Suspense>
		</>
	);
}
