import {
	Database,
	Network,
	Route,
	ShieldCheck,
	SlidersHorizontal,
	Server,
} from "lucide-react";

import Footer from "@/components/landing/footer";
import { Navbar } from "@/components/landing/navbar";
import {
	ProductClosingCta,
	ProductCodeBlock,
	ProductFeatureGrid,
	ProductHero,
	ProductScreenshot,
	productJsonLd,
} from "@/components/products/product-sections";

import { MARKETING_STATS } from "@llmgateway/shared";

import type { Metadata } from "next";

const title = "AI Gateway — One API for Every LLM Provider";
const description = `Route requests to ${MARKETING_STATS.models} models across ${MARKETING_STATS.providers} providers through one OpenAI-compatible endpoint — with smart routing, automatic fallback, caching, and guardrails.`;

export const metadata: Metadata = {
	title,
	description,
	alternates: { canonical: "/products/ai-gateway" },
	openGraph: {
		title,
		description,
		url: "https://llmgateway.io/products/ai-gateway",
		type: "website",
	},
};

const features = [
	{
		icon: Network,
		title: "OpenAI-compatible API",
		description:
			"Keep your existing SDK and change the base URL — chat completions, embeddings, images, video, speech, and transcription all speak the same format.",
	},
	{
		icon: Route,
		title: "Smart routing & fallback",
		description:
			"Route by price, latency, throughput, or uptime, and fall back to the next healthy provider automatically when one degrades.",
	},
	{
		icon: Database,
		title: "Response caching",
		description:
			"Serve repeated requests from Redis-backed cache and pass provider cache controls through — cutting both latency and spend.",
	},
	{
		icon: ShieldCheck,
		title: "Guardrails",
		description:
			"Prompt-injection protection, PII detection and redaction, secrets detection, and a custom rules engine — enforced at the gateway.",
	},
	{
		icon: SlidersHorizontal,
		title: "Key management",
		description:
			"Centralized, encrypted provider keys with project-scoped API keys, usage and spending limits, and full audit trails.",
	},
	{
		icon: Server,
		title: "Cloud or self-hosted",
		description:
			"Use the hosted gateway or deploy the AGPLv3-licensed source on your own infrastructure with Docker, Compose, or Kubernetes.",
	},
];

const codeExample = `import OpenAI from "openai";

const client = new OpenAI({
	baseURL: "https://api.llmgateway.io/v1",
	apiKey: process.env.LLM_GATEWAY_API_KEY,
});

const completion = await client.chat.completions.create({
	model: "openai/gpt-5", // or anthropic/claude-*, google/gemini-*, ...
	messages: [{ role: "user", content: "Hello!" }],
});`;

export default function AiGatewayProductPage() {
	const jsonLd = productJsonLd({
		slug: "ai-gateway",
		name: "AI Gateway",
		description,
	});

	return (
		<>
			{jsonLd.map((schema, i) => (
				<script
					key={i}
					type="application/ld+json"
					// eslint-disable-next-line @eslint-react/dom/no-dangerously-set-innerhtml
					dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
				/>
			))}
			<Navbar />
			<main className="min-h-screen bg-background">
				<ProductHero
					accent="blue"
					eyebrow="Product · AI Gateway"
					title="One API for every LLM"
					subtitle={`${MARKETING_STATS.models} models. ${MARKETING_STATS.providers} providers. Zero code changes.`}
					description="Stop juggling API keys and provider dashboards. The AI Gateway routes your requests across every major provider through one OpenAI-compatible endpoint — with smart routing, automatic fallback, caching, and guardrails built in."
					ctas={[
						{ label: "Get My API Key", href: "/signup" },
						{
							label: "Read the docs",
							href: "https://docs.llmgateway.io",
							external: true,
							variant: "outline",
						},
					]}
					stats={[
						{ value: MARKETING_STATS.models, label: "Models" },
						{ value: MARKETING_STATS.providers, label: "Providers" },
						{ value: MARKETING_STATS.tokensRouted, label: "Tokens routed" },
					]}
				/>

				<div className="mx-auto max-w-6xl space-y-24 px-6 py-20 md:space-y-36 md:py-28">
					<section>
						<div className="scroll-reveal mx-auto mb-10 max-w-xl text-center">
							<h2 className="text-3xl font-semibold tracking-[-0.02em] md:text-4xl">
								Migrate by changing one line
							</h2>
							<p className="mt-3 text-pretty leading-relaxed text-muted-foreground">
								Point your existing OpenAI SDK at the gateway. Everything else
								stays the same.
							</p>
						</div>
						<ProductCodeBlock code={codeExample} filename="app.ts" />
					</section>

					<ProductScreenshot
						slug="api-keys"
						alt="LLM Gateway API keys management"
						title="Project-scoped API keys"
						description="Create keys per project, set usage and spending limits, and rotate them without touching your code."
					/>

					<ProductFeatureGrid
						title="Built for production traffic"
						features={features}
					/>
				</div>

				<ProductClosingCta
					accent="blue"
					title="Ship with any model, today"
					description="Bring your own provider keys for free, pay as you go with a flat 5% platform fee, or self-host the open-source gateway."
					ctas={[
						{ label: "Get My API Key", href: "/signup" },
						{ label: "See pricing", href: "/pricing", variant: "outline" },
					]}
				/>
			</main>
			<Footer />
		</>
	);
}
