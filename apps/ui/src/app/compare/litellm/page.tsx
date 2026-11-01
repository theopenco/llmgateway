import { CompareFaq } from "@/components/compare/compare-faq";
import { ComparisonSources } from "@/components/compare/comparison-sources";
import { HeroCompare } from "@/components/compare/hero-compare";
import { ComparisonLiteLLM } from "@/components/landing/comparison-litellm";
import Footer from "@/components/landing/footer";
import { pageTitle } from "@/lib/page-title";

import type { CompareFaqItem } from "@/components/compare/compare-faq";

const liteLlmFaqs: CompareFaqItem[] = [
	{
		question: "How do LiteLLM and LLM Gateway differ?",
		answer:
			"LiteLLM provides a Python SDK and self-hosted gateway with an Admin UI, virtual keys, budgets, logging, routing and a model playground. LLM Gateway offers managed hosting as well as a self-hosted core. The main choice is how much infrastructure and configuration your team wants to operate.",
	},
	{
		question: "Has LiteLLM been compromised?",
		answer:
			"Yes, twice in 2026. On March 24, litellm 1.82.7 and 1.82.8 on PyPI carried a credential stealer for about 40 minutes. On October 21, litellm 1.107.0 on PyPI and the official Docker images shipped an infostealer that read stored provider keys, plus a remote access trojan. Security researchers at FutureSearch, Aikido and JFrog published the affected artifacts and what to rotate.",
	},
	{
		question: "How does LiteLLM pricing work?",
		answer:
			"LiteLLM OSS has no license fee for self-hosting, including production use. You still pay for infrastructure and inference. Enterprise is quoted annually based on gateway request capacity, deployment architecture and support, rather than token markup.",
	},
	{
		question: "Which LiteLLM features require Enterprise?",
		answer:
			"Its current Enterprise offering includes SSO, SCIM, audit logs, advanced access controls, secret management and support SLAs. Some built-in guardrail integrations also require a commercial license. Check the edition matrix for the controls you need.",
	},
	{
		question: "Does LiteLLM have analytics and a playground?",
		answer:
			"Yes. Its Admin UI and model comparison playground report usage, cost and latency. It also supports Prometheus and logging integrations. LLM Gateway provides its own dashboard and Lounge; analytics and browser testing are not exclusive to LLM Gateway.",
	},
	{
		question: "What does LLM Gateway charge?",
		answer:
			"The managed gateway charges a 5% fee on purchased credits and no BYOK platform fee. Full request storage is an Enterprise feature billed separately. The AGPLv3 core is free to self-host subject to the license; enterprise features use commercial terms.",
	},
	{
		question: "What changes during migration?",
		answer:
			"OpenAI-compatible calls can reuse their request format, with a new endpoint, key and model ID. Migrate LiteLLM aliases, virtual-key budgets, callbacks and routing configuration explicitly. Test any SDK-specific behavior against the destination gateway.",
	},
];

export default function CompareLiteLLMPage() {
	return (
		<div className="min-h-screen bg-white text-black dark:bg-black dark:text-white">
			<main>
				<HeroCompare
					content={{
						heading: "Why Choose LLM Gateway Over LiteLLM?",
						description:
							"Compare our managed gateway with prepaid credits, analytics, routing and enterprise features against LiteLLM's self-hosted proxy, which shipped compromised releases twice in 2026.",
						badges: [
							"Managed Infrastructure",
							"No Proxy to Patch",
							"Advanced Analytics",
							"Enterprise Support",
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
				<ComparisonLiteLLM />
				<ComparisonSources slug="litellm" />
				<CompareFaq
					heading="LLM Gateway vs LiteLLM"
					description="Common questions about choosing LLM Gateway over LiteLLM."
					faqs={liteLlmFaqs}
				/>
			</main>
			<Footer />
		</div>
	);
}

export async function generateMetadata() {
	return {
		title: pageTitle("LLM Gateway vs LiteLLM — Feature Comparison"),
		description:
			"Compare managed hosting, supply-chain security and billing vs LiteLLM's self-hosted proxy, compromised twice in 2026. See why teams pick LLM Gateway.",
		alternates: { canonical: "/compare/litellm" },
		openGraph: {
			title: "LLM Gateway vs LiteLLM — Feature Comparison",
			description:
				"Compare managed hosting, supply-chain security and billing vs LiteLLM's self-hosted proxy.",
			type: "website",
			url: "https://llmgateway.io/compare/litellm",
		},
		twitter: {
			card: "summary_large_image",
			title: "LLM Gateway vs LiteLLM — Feature Comparison",
			description:
				"Compare managed hosting, supply-chain security and billing vs LiteLLM's self-hosted proxy.",
		},
	};
}
