import dynamic from "next/dynamic";

import { HeroRSC } from "@/components/landing/hero-rsc";

const Features = dynamic(() => import("@/components/landing/features"));
const TrustBar = dynamic(() =>
	import("@/components/enterprise/trust-bar").then(
		(mod) => mod.TrustBarEnterprise,
	),
);
const Uptime = dynamic(() =>
	import("@/components/enterprise/uptime").then(
		(mod) => mod.UptimeVisualization,
	),
);
const PricingStrip = dynamic(() =>
	import("@/components/landing/pricing-strip").then((mod) => mod.PricingStrip),
);
const Testimonials = dynamic(() =>
	import("@/components/landing/testimonials").then((mod) => mod.Testimonials),
);
const Graph = dynamic(() =>
	import("@/components/landing/graph").then((mod) => mod.Graph),
);
const CodeExample = dynamic(() =>
	import("@/components/landing/code-example").then((mod) => mod.CodeExample),
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

export default function Home() {
	return (
		<>
			<HeroRSC />
			<TrustBar />
			<Features />
			<Graph />
			<CodeExample />
			<Uptime />
			<Testimonials />
			<PricingStrip />
			<Faq />
			<EnterpriseCTA />
			<CallToAction />
			<Footer />
		</>
	);
}
