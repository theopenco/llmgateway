import Footer from "@/components/landing/footer";
import { HeroRSC } from "@/components/landing/hero-rsc";
import { McpContent } from "@/components/mcp/mcp-content";

export const metadata = {
	title: "MCP Server | LLM Gateway",
	description:
		"Use LLM Gateway as an MCP server for Claude Code, Cursor, and other AI assistants. Access 200+ models from OpenAI, Anthropic, Google, and more.",
	openGraph: {
		title: "MCP Server | LLM Gateway",
		description:
			"Use LLM Gateway as an MCP server for Claude Code, Cursor, and other AI assistants. Access 200+ models from OpenAI, Anthropic, Google, and more.",
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
							Connect your AI assistant to 200+ LLM models through the Model
							Context Protocol. Works with Claude Code, Cursor, and any
							MCP-compatible client.
						</p>
					</div>
					<McpContent />
				</div>
			</section>
			<Footer />
		</div>
	);
}
