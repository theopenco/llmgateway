import { CompareFaq } from "@/components/compare/compare-faq";
import { HeroCompare } from "@/components/compare/hero-compare";
import { ComparisonAzureFoundry } from "@/components/landing/comparison-azure-foundry";
import Footer from "@/components/landing/footer";

import type { CompareFaqItem } from "@/components/compare/compare-faq";

const foundryFaqs: CompareFaqItem[] = [
	{
		question: "Is LLM Gateway a good Azure AI Foundry alternative?",
		answer:
			"Yes — if you want frontier models without committing to one cloud. LLM Gateway puts 200+ models from 40+ providers behind a single OpenAI-compatible API, with automatic routing, failover, caching, and per-request cost analytics. It's fully open source (AGPLv3) and self-hostable, and there are no deployments or TPM quotas to manage.",
	},
	{
		question: "Can I keep using Azure with LLM Gateway?",
		answer:
			"Yes. Azure OpenAI and Azure AI Foundry are built-in LLM Gateway providers. Bring your Azure credentials and route your Azure traffic through the gateway with 0% markup — you keep your Microsoft agreements and compliance posture while gaining cross-provider failover, caching, and unified analytics on top.",
	},
	{
		question: "Doesn't Foundry already have OpenAI and Claude models?",
		answer:
			"It does — Foundry hosts OpenAI's models and Anthropic's Claude family, among a large Azure-hosted catalog. But everything runs inside Azure: there's no Google Gemini and no fast independent hosts like Groq or Cerebras, and each model needs a deployment with quota. LLM Gateway routes across all of them, including Azure itself, from one API with no provisioning.",
	},
	{
		question: "How does pricing compare to Azure AI Foundry?",
		answer:
			"Foundry bills model rates through your Azure subscription, with provisioned-throughput (PTU) reservations for guaranteed capacity. LLM Gateway charges the same provider rates with a flat 5% platform fee on credits — or 0% when you bring your own provider keys, including Azure credentials. Self-hosting the open-source gateway is free.",
	},
	{
		question: "How hard is it to migrate from Azure AI Foundry to LLM Gateway?",
		answer:
			"Minimal effort. LLM Gateway exposes an OpenAI-compatible API, so most apps switch by changing the base URL and API key. There are no resources to create, models to deploy, or regional quotas to plan — sign up, create a key, and every supported model is available immediately.",
	},
];

export default function CompareAzureFoundryPage() {
	return (
		<div className="min-h-screen bg-white text-black dark:bg-black dark:text-white">
			<main>
				<HeroCompare
					content={{
						heading: "Looking Beyond Azure AI Foundry?",
						description:
							"Foundry gives you the models Azure hosts — after you create resources, deployments, and quotas. LLM Gateway gives you every major lab and cloud — including Azure itself — behind one open-source, OpenAI-compatible API. No provisioning required.",
						badges: [
							"Cloud-Neutral",
							"Fully Open Source",
							"No Deployments or Quotas",
							"Azure Built In",
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
				<ComparisonAzureFoundry />
				<CompareFaq
					heading="LLM Gateway vs Azure AI Foundry"
					description="Common questions about using LLM Gateway alongside or instead of Azure AI Foundry."
					faqs={foundryFaqs}
				/>
			</main>
			<Footer />
		</div>
	);
}

export async function generateMetadata() {
	return {
		title: "LLM Gateway vs Azure AI Foundry — The Cloud-Neutral Alternative",
		description:
			"Compare LLM Gateway and Azure AI Foundry: 40+ providers behind one OpenAI-compatible API vs an Azure-hosted catalog with deployments and quotas. Keep Azure as a provider with 0% markup and add cross-cloud failover, caching, and cost analytics.",
		openGraph: {
			title: "LLM Gateway vs Azure AI Foundry - Feature Comparison",
			description:
				"Compare LLM Gateway's cloud-neutral, open-source platform against Azure AI Foundry's Azure-hosted model catalog. Route to Azure and 40+ other providers from one API.",
			type: "website",
		},
		twitter: {
			card: "summary_large_image",
			title: "LLM Gateway vs Azure AI Foundry - Feature Comparison",
			description:
				"Compare LLM Gateway's cloud-neutral, open-source platform against Azure AI Foundry's Azure-hosted model catalog. Route to Azure and 40+ other providers from one API.",
		},
	};
}
