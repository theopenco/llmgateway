import { LayoutGrid, Wallet } from "lucide-react";

import Footer from "@/components/landing/footer";
import { HeroRSC } from "@/components/landing/hero-rsc";
import { TemplateCards } from "@/components/templates/template-cards";
import { Button } from "@/lib/components/button";

import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "AI App Templates — Production-Ready Starters",
	description:
		"Production-ready templates to jumpstart your AI applications — image generation, chatbots, end-user monetization, and more.",
	openGraph: {
		title: "AI App Templates — Production-Ready Starters",
		description:
			"Production-ready templates to jumpstart your AI applications — image generation, chatbots, end-user monetization, and more.",
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

			{/* Showcase + Powered-By distribution loop */}
			<section className="py-16 sm:py-20 bg-muted/30">
				<div className="container mx-auto px-4 sm:px-6 lg:px-8">
					<div className="mx-auto grid max-w-5xl gap-6 md:grid-cols-2">
						<div className="flex flex-col rounded-2xl border bg-card p-8 shadow-sm">
							<div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500 to-rose-500 shadow-lg">
								<LayoutGrid className="h-6 w-6 text-white" />
							</div>
							<h3 className="mt-5 text-xl font-bold tracking-tight">
								Built something? Get featured.
							</h3>
							<p className="mt-2 flex-1 text-muted-foreground leading-relaxed">
								Ship an app on any template and add it to the Showcase — a
								public, filterable gallery of apps built with LLM Gateway.
								It&apos;s a deployable template itself, so you can host your
								own.
							</p>
							<div className="mt-6 flex flex-col gap-3 sm:flex-row">
								<Button asChild className="font-semibold">
									<a
										href="https://github.com/theopenco/llmgateway-templates/issues/new?template=showcase-submission.yml"
										target="_blank"
										rel="noopener noreferrer"
									>
										Submit your app
									</a>
								</Button>
								<Button variant="outline" asChild>
									<a
										href="https://github.com/theopenco/llmgateway-templates/tree/main/templates/showcase"
										target="_blank"
										rel="noopener noreferrer"
									>
										View the Showcase
									</a>
								</Button>
							</div>
						</div>

						<div className="flex flex-col rounded-2xl border bg-card p-8 shadow-sm">
							<div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-cyan-500 shadow-lg">
								<Wallet className="h-6 w-6 text-white" />
							</div>
							<h3 className="mt-5 text-xl font-bold tracking-tight">
								Add the Powered-By badge
							</h3>
							<p className="mt-2 flex-1 text-muted-foreground leading-relaxed">
								Every app you deploy can carry a small &ldquo;Powered by LLM
								Gateway&rdquo; badge. It ships with the embeddable SDK (
								<code className="rounded bg-muted px-1.5 py-0.5 text-sm">
									&lt;PoweredBy /&gt;
								</code>
								) and as a dependency-free copy you can drop into any footer.
							</p>
							<div className="mt-6">
								<Button variant="outline" asChild>
									<a
										href="https://docs.llmgateway.io/features/llm-sdk"
										target="_blank"
										rel="noopener noreferrer"
									>
										Read the SDK docs
									</a>
								</Button>
							</div>
						</div>
					</div>
				</div>
			</section>

			<Footer />
		</div>
	);
}
