import { AgentCards } from "@/components/agents/agent-cards";
import Footer from "@/components/landing/footer";
import { HeroRSC } from "@/components/landing/hero-rsc";

import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "Agents | LLM Gateway",
	description:
		"Pre-built AI agents ready to integrate into your applications. Weather, search, and more.",
	openGraph: {
		title: "Agents | LLM Gateway",
		description:
			"Pre-built AI agents ready to integrate into your applications. Weather, search, and more.",
	},
};

export default function AgentsPage() {
	return (
		<div>
			<HeroRSC navbarOnly />
			<section className="py-20 sm:py-28">
				<div className="container mx-auto px-4 sm:px-6 lg:px-8">
					<div className="mx-auto max-w-2xl text-center mb-16">
						<h1 className="mb-4 text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
							Agents
						</h1>
						<p className="text-lg text-muted-foreground leading-relaxed">
							Pre-built AI agents with tool calling capabilities. Ready to
							integrate and extend for your specific needs.
						</p>
					</div>
					<AgentCards />
				</div>
			</section>
			<Footer />
		</div>
	);
}
