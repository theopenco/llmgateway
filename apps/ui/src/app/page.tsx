import dynamic from "next/dynamic";

import { HeroRSC } from "@/components/landing/hero-rsc";

const Features = dynamic(() => import("@/components/landing/features"));
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
			<Features />
			<Graph />
			<CodeExample />
			<Faq />
			<EnterpriseCTA />
			<CallToAction />
			<Footer />
		</>
	);
}
