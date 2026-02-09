import dynamic from "next/dynamic";

import Features from "@/components/landing/features";
import { HeroRSC } from "@/components/landing/hero-rsc";
import { Testimonials } from "@/components/landing/testimonials";

const Graph = dynamic(() =>
	import("@/components/landing/graph").then((mod) => mod.Graph),
);
const CodeExample = dynamic(() =>
	import("@/components/landing/code-example").then((mod) => mod.CodeExample),
);
const Faq = dynamic(() =>
	import("@/components/landing/faq").then((mod) => mod.Faq),
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
			<Testimonials />
			<Faq />
			<CallToAction />
			<Footer />
		</>
	);
}
