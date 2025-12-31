import { IntegrationCards } from "@/components/integrations/integration-cards";
import Footer from "@/components/landing/footer";
import { HeroRSC } from "@/components/landing/hero-rsc";

export const metadata = {
	title: "Integrations | LLM Gateway",
	description:
		"Connect LLM Gateway with your favorite tools. Integrate with Claude Code, Cursor, Cline, n8n, and more.",
	openGraph: {
		title: "Integrations | LLM Gateway",
		description:
			"Connect LLM Gateway with your favorite tools. Integrate with Claude Code, Cursor, Cline, n8n, and more.",
	},
};

export default function IntegrationsPage() {
	return (
		<div>
			<HeroRSC navbarOnly />
			<section className="py-20 sm:py-28">
				<div className="container mx-auto px-4 sm:px-6 lg:px-8">
					<div className="mx-auto max-w-2xl text-center mb-16">
						<h1 className="mb-4 text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
							Integrations
						</h1>
						<p className="text-lg text-muted-foreground leading-relaxed">
							Connect LLM Gateway with your favorite tools and workflows. Access
							powerful AI capabilities wherever you work.
						</p>
					</div>
					<IntegrationCards />
				</div>
			</section>
			<Footer />
		</div>
	);
}
