import { CompareFaq } from "@/components/compare/compare-faq";
import { HeroCompare } from "@/components/compare/hero-compare";
import { ComparisonBedrock } from "@/components/landing/comparison-bedrock";
import Footer from "@/components/landing/footer";

import type { CompareFaqItem } from "@/components/compare/compare-faq";

const bedrockFaqs: CompareFaqItem[] = [
	{
		question: "Is LLM Gateway a good AWS Bedrock alternative?",
		answer:
			"Yes — if you want frontier models without committing to one cloud. LLM Gateway puts 200+ models from 40+ providers behind a single OpenAI-compatible API, with automatic routing, failover, caching, and per-request cost analytics. It's fully open source (AGPLv3) and self-hostable, so nothing ties you to a hyperscaler.",
	},
	{
		question: "Can I keep using AWS Bedrock with LLM Gateway?",
		answer:
			"Yes. AWS Bedrock is a built-in LLM Gateway provider. Bring your own AWS credentials and route Bedrock traffic through the gateway with 0% markup — you keep your AWS commitments and compliance posture while gaining cross-provider failover, caching, and unified analytics on top.",
	},
	{
		question: "Doesn't Bedrock already have OpenAI and Anthropic models?",
		answer:
			"It does — Bedrock hosts OpenAI's frontier models and Anthropic's Claude family, among others. But the catalog is limited to what AWS hosts: there's no Google Gemini and no fast independent hosts like Groq or Cerebras. LLM Gateway routes across all of them, including Bedrock itself, from one API.",
	},
	{
		question: "How does pricing compare to AWS Bedrock?",
		answer:
			"Bedrock bills model-provider rates through your AWS account. LLM Gateway charges the same provider rates with a flat 5% platform fee on credits — or 0% when you bring your own provider keys, including AWS credentials. Self-hosting the open-source gateway is free.",
	},
	{
		question: "How hard is it to migrate from Bedrock to LLM Gateway?",
		answer:
			"Minimal effort. LLM Gateway exposes an OpenAI-compatible API, so most apps switch by changing the base URL and API key. There's no IAM policy work, model-access requests, or region planning — sign up, create a key, and every supported model is available immediately.",
	},
];

export default function CompareBedrockPage() {
	return (
		<div className="min-h-screen bg-white text-black dark:bg-black dark:text-white">
			<main>
				<HeroCompare
					content={{
						heading: "Looking Beyond AWS Bedrock?",
						description:
							"Bedrock gives you the models AWS hosts. LLM Gateway gives you every major lab and cloud — including Bedrock itself — behind one open-source, OpenAI-compatible API with automatic routing and failover.",
						badges: [
							"Cloud-Neutral",
							"Fully Open Source",
							"Cross-Cloud Failover",
							"Bedrock Built In",
						],
						cta: {
							primary: {
								text: "Start for Free",
								href: "/signup",
							},
							secondary: {
								text: "View Documentation",
								href: "https://docs.llmgateway.io",
								external: true,
							},
						},
					}}
				/>
				<ComparisonBedrock />
				<CompareFaq
					heading="LLM Gateway vs AWS Bedrock"
					description="Common questions about using LLM Gateway alongside or instead of Amazon Bedrock."
					faqs={bedrockFaqs}
				/>
			</main>
			<Footer />
		</div>
	);
}

export async function generateMetadata() {
	return {
		title: "LLM Gateway vs AWS Bedrock — The Cloud-Neutral Alternative",
		description:
			"Compare 40+ providers behind one OpenAI-compatible API vs Amazon Bedrock. Keep Bedrock with 0% markup plus failover, caching, and cost analytics.",
		alternates: { canonical: "/compare/aws-bedrock" },
		openGraph: {
			title: "LLM Gateway vs AWS Bedrock — Feature Comparison",
			description:
				"Cloud-neutral gateway vs AWS Bedrock. Route to Bedrock and 40+ providers from one API with failover and analytics.",
			type: "website",
			url: "https://llmgateway.io/compare/aws-bedrock",
		},
		twitter: {
			card: "summary_large_image",
			title: "LLM Gateway vs AWS Bedrock — Feature Comparison",
			description:
				"Cloud-neutral gateway vs AWS Bedrock. Route to Bedrock and 40+ providers from one API.",
		},
	};
}
