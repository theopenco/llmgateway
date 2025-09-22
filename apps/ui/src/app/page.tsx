import { CodeExample } from "@/components/landing/code-example";
import CallToAction from "@/components/landing/cta";
import { Faq } from "@/components/landing/faq";
import Features from "@/components/landing/features";
import Footer from "@/components/landing/footer";
import { Graph } from "@/components/landing/graph";
import { HeroRSC } from "@/components/landing/hero-rsc";
import { PricingPlans } from "@/components/landing/pricing-plans";
import { Testimonials } from "@/components/landing/testimonials";

export default function Home() {
	return (
		<>
			<HeroRSC />
			<Features />
			<Graph />
			<CodeExample />
			<PricingPlans />
			<Testimonials />
			<Faq />
			<CallToAction />
			<Footer />
		</>
	);
}
