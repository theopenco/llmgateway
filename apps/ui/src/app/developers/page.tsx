import Link from "next/link";

import Footer from "@/components/landing/footer";
import { HeroRSC } from "@/components/landing/hero-rsc";

import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "Developer Resources",
	description:
		"LLM Gateway API documentation, authentication, OpenAPI specification, developer dashboard, and MCP server.",
};

const resources = [
	{
		title: "LLM Gateway API documentation",
		href: "https://docs.llmgateway.io",
		description:
			"Reference, SDK examples, and a quick start for the OpenAI-compatible API.",
	},
	{
		title: "LLM Gateway OpenAPI specification",
		href: "/openapi.json",
		description:
			"Machine-readable request, response, and error schemas for API clients.",
	},
	{
		title: "LLM Gateway authentication",
		href: "https://docs.llmgateway.io/features/api-keys",
		description:
			"Create a project API key and send it in the Authorization: Bearer header.",
	},
	{
		title: "LLM Gateway developer dashboard",
		href: "/dashboard",
		description:
			"Manage projects, API keys, usage, and spending limits. Sign in to access your account.",
	},
	{
		title: "LLM Gateway MCP server",
		href: "/mcp",
		description:
			"Connect an assistant through Streamable HTTP to discover models, generate content, and inspect usage.",
	},
	{
		title: "LLM Gateway API versioning policy",
		href: "https://docs.llmgateway.io/resources/api-versioning",
		description:
			"Compatibility, deprecation notices, and retirement information.",
	},
] as const;

export default function DevelopersPage() {
	return (
		<>
			<HeroRSC navbarOnly />
			<main className="container mx-auto max-w-4xl px-6 py-28">
				<h1 className="text-4xl font-bold tracking-tight">
					LLM Gateway Developer Resources
				</h1>
				<p className="mt-6 text-lg text-muted-foreground">
					Build with one OpenAI-compatible API at{" "}
					<code>https://api.llmgateway.io/v1</code>. Start with the
					documentation, create an API key, or connect your assistant using MCP.
				</p>
				<ul className="mt-12 space-y-8">
					{resources.map((resource) => (
						<li key={resource.href}>
							<h2 className="text-xl font-semibold">
								<Link
									href={resource.href}
									className="underline underline-offset-4"
								>
									{resource.title}
								</Link>
							</h2>
							<p className="mt-2 text-muted-foreground">
								{resource.description}
							</p>
						</li>
					))}
				</ul>
				<p className="mt-12">
					Agents can start with the&nbsp;
					<Link
						href="/llms.txt"
						className="whitespace-nowrap underline underline-offset-4"
					>
						LLM Gateway content index
					</Link>
					.
				</p>
			</main>
			<Footer />
		</>
	);
}
