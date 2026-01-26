import Footer from "@/components/landing/footer";
import { HeroRSC } from "@/components/landing/hero-rsc";
import { TemplateCards } from "@/components/templates/template-cards";

import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "Templates | LLM Gateway",
	description:
		"Production-ready templates to jumpstart your AI applications. Image generation, chatbots, and more.",
	openGraph: {
		title: "Templates | LLM Gateway",
		description:
			"Production-ready templates to jumpstart your AI applications. Image generation, chatbots, and more.",
	},
};

export default function TemplatesPage() {
	return (
		<div>
			<HeroRSC navbarOnly />
			<section className="py-20 sm:py-28">
				<div className="container mx-auto px-4 sm:px-6 lg:px-8">
					<div className="mx-auto max-w-2xl text-center mb-16">
						<h1 className="mb-4 text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
							Templates
						</h1>
						<p className="text-lg text-muted-foreground leading-relaxed">
							Production-ready templates to help you build AI-powered
							applications faster. Clone, customize, and deploy.
						</p>
					</div>
					<TemplateCards />
				</div>
			</section>
			<Footer />
		</div>
	);
}
