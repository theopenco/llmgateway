import Footer from "@/components/landing/footer";
import { HeroRSC } from "@/components/landing/hero-rsc";
import { McpContent } from "@/components/mcp/mcp-content";

export const metadata = {
	title: "MCP Server — Usage, Costs & Model Access",
	description:
		"Connect your AI assistant to LLM Gateway. Track usage and costs, find your most-used models, providers and coding apps, and generate text or images.",
	openGraph: {
		title: "MCP Server — Usage, Costs & Model Access",
		description:
			"Connect your AI assistant to LLM Gateway. Track usage and costs, find your most-used models, providers and coding apps, and generate text or images.",
	},
};

export default function McpPage() {
	return (
		<div>
			<HeroRSC navbarOnly />
			<section className="py-20 sm:py-28">
				<div className="container mx-auto px-4 sm:px-6 lg:px-8">
					<div className="mx-auto max-w-2xl text-center mb-16">
						<h1 className="mb-4 text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
							MCP Server
						</h1>
						<p className="text-lg text-muted-foreground leading-relaxed">
							Ask your AI assistant about your usage, costs, and most-used
							models, providers, and coding apps. Generate text and images
							through the same MCP connection.
						</p>
					</div>
					<McpContent />
				</div>
			</section>
			<Footer />
		</div>
	);
}
