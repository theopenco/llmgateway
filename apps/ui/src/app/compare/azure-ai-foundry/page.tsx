import { CompareFaq } from "@/components/compare/compare-faq";
import { ComparisonSources } from "@/components/compare/comparison-sources";
import { HeroCompare } from "@/components/compare/hero-compare";
import { ComparisonAzureFoundry } from "@/components/landing/comparison-azure-foundry";
import Footer from "@/components/landing/footer";

import type { CompareFaqItem } from "@/components/compare/compare-faq";

const foundryFaqs: CompareFaqItem[] = [
	{
		question: "Is Microsoft Foundry the same as Azure AI Foundry?",
		answer:
			"Microsoft Foundry is the current name for the platform previously called Azure AI Foundry. It combines model deployment, agents, evaluation, observability and governance. We retain the original comparison URL for existing links.",
	},
	{
		question: "What has Foundry model router added?",
		answer:
			"Foundry offers model selection and automatic fallback within its supported model pool. September 2026 updates add preview session affinity and per-request routing metadata, including model attempts and errors. These are genuine routing capabilities, not just manual deployment management.",
	},
	{
		question: "How does Foundry pricing work?",
		answer:
			"Foundry bills the services and model deployments you use through Azure. Model, region, deployment type and additional services affect the total. Pay-as-you-go and provisioned throughput are alternatives where supported; a PTU reservation is not required for every request.",
	},
	{
		question: "How does LLM Gateway pricing compare?",
		answer:
			"LLM Gateway charges a 5% fee on credits or no platform fee with your own provider keys. Optional request storage and enterprise features are separate. Azure credentials keep provider charges on your Azure account, subject to the underlying deployment and agreement.",
	},
	{
		question: "Does a gateway remove Azure quotas?",
		answer:
			"No. Managed LLM Gateway credits avoid setting up your own deployment for supported routes. When you bring Azure credentials, your deployments, permissions and capacity limits still apply. Foundry is a better fit when Azure governance and managed agent services are the priority.",
	},
	{
		question: "What needs to change during migration?",
		answer:
			"Map deployment names to supported model IDs and verify the API surface your application uses. OpenAI-compatible chat calls are straightforward to move, but Foundry agents, tools, identity, networking and evaluation workflows need separate migration work.",
	},
];

export default function CompareAzureFoundryPage() {
	return (
		<div className="min-h-screen bg-white text-black dark:bg-black dark:text-white">
			<main>
				<HeroCompare
					content={{
						heading: "Looking Beyond Microsoft Foundry?",
						description:
							"Foundry gives you the models Azure hosts — after you create resources, deployments, and quotas. LLM Gateway gives you multiple labs and clouds — including Azure itself — behind one open-source, OpenAI-compatible API. Managed access for supported routes.",
						badges: [
							"Cloud-Neutral",
							"Open-Source Core",
							"Managed Model Access",
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
				<ComparisonSources slug="azure-ai-foundry" />
				<CompareFaq
					heading="LLM Gateway vs Microsoft Foundry"
					description="Common questions about using LLM Gateway alongside or instead of Microsoft Foundry, formerly Azure AI Foundry."
					faqs={foundryFaqs}
				/>
			</main>
			<Footer />
		</div>
	);
}

export async function generateMetadata() {
	return {
		title:
			"LLM Gateway vs Microsoft Foundry (Azure AI Foundry) — The Cloud-Neutral Alternative",
		description:
			"Compare multiple providers behind one OpenAI-compatible API vs Microsoft Foundry, formerly Azure AI Foundry. Keep Azure with 0% markup plus failover, caching, and cost analytics.",
		alternates: { canonical: "/compare/azure-ai-foundry" },
		openGraph: {
			title: "LLM Gateway vs Microsoft Foundry — Feature Comparison",
			description:
				"Cloud-neutral gateway vs Microsoft Foundry (formerly Azure AI Foundry). Route to Azure and multiple providers from one API with failover and analytics.",
			type: "website",
			url: "https://llmgateway.io/compare/azure-ai-foundry",
		},
		twitter: {
			card: "summary_large_image",
			title: "LLM Gateway vs Microsoft Foundry — Feature Comparison",
			description:
				"Cloud-neutral gateway vs Microsoft Foundry (formerly Azure AI Foundry). Route to Azure and multiple providers from one API.",
		},
	};
}
