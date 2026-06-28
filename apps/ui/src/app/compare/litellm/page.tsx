import { CompareFaq } from "@/components/compare/compare-faq";
import { HeroCompare } from "@/components/compare/hero-compare";
import { ComparisonLiteLLM } from "@/components/landing/comparison-litellm";
import Footer from "@/components/landing/footer";

import type { CompareFaqItem } from "@/components/compare/compare-faq";

const liteLlmFaqs: CompareFaqItem[] = [
	{
		question: "What's the difference between LLM Gateway and LiteLLM?",
		answer:
			"LiteLLM is a self-hosted proxy you run and operate yourself. LLM Gateway is a production-ready gateway with a managed hosted option, a dashboard, real-time analytics, and automatic provider routing and fallback — so there's no infrastructure to run unless you want to self-host.",
	},
	{
		question: "Do I have to host it myself like LiteLLM?",
		answer:
			"No. You can use the fully managed gateway, or self-host the AGPLv3 build on your own infrastructure — the choice is yours.",
	},
	{
		question: "Is LLM Gateway open source?",
		answer:
			"Yes. The core gateway is AGPLv3 licensed and free to self-host forever, just like LiteLLM, while also offering a managed service.",
	},
	{
		question: "How does pricing work compared to LiteLLM?",
		answer:
			"Managed usage is pay-as-you-go with a flat 5% platform fee on credits, or free when you bring your own provider keys. Self-hosting the AGPLv3 build is free.",
	},
	{
		question: "Does it provide analytics and routing out of the box?",
		answer:
			"Yes. Real-time cost and latency analytics, automatic provider routing and fallback, budgets and spend controls, and prompt caching are built in — no extra setup required.",
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
							"Compare our production-ready managed gateway with advanced analytics, routing, and enterprise features against LiteLLM's self-hosted proxy solution.",
						badges: [
							"Managed Infrastructure",
							"Advanced Analytics",
							"Enterprise Support",
							"Production Ready",
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
		title: "LLM Gateway vs LiteLLM — Feature Comparison",
		description:
			"Compare LLM Gateway's managed infrastructure, advanced analytics, and enterprise features against LiteLLM's self-hosted proxy solution. See why teams choose our production-ready API gateway.",
		openGraph: {
			title: "LLM Gateway vs LiteLLM - Feature Comparison",
			description:
				"Compare LLM Gateway's managed infrastructure, advanced analytics, and enterprise features against LiteLLM's self-hosted proxy solution. See why teams choose our production-ready API gateway.",
			type: "website",
		},
		twitter: {
			card: "summary_large_image",
			title: "LLM Gateway vs LiteLLM - Feature Comparison",
			description:
				"Compare LLM Gateway's managed infrastructure, advanced analytics, and enterprise features against LiteLLM's self-hosted proxy solution.",
		},
	};
}
