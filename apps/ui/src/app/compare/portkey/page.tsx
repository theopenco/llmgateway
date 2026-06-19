import { CompareFaq } from "@/components/compare/compare-faq";
import { HeroCompare } from "@/components/compare/hero-compare";
import { ComparisonPortkey } from "@/components/landing/comparison-portkey";
import Footer from "@/components/landing/footer";

import type { CompareFaqItem } from "@/components/compare/compare-faq";

const portkeyFaqs: CompareFaqItem[] = [
	{
		question: "Is LLM Gateway a good Portkey alternative?",
		answer:
			"Yes. LLM Gateway is fully open source (AGPLv3) and self-hostable, with automatic provider routing and fallback, real-time cost and latency analytics, and transparent per-token pricing with no markup. Unlike Portkey, the entire gateway can run on your own infrastructure.",
	},
	{
		question: "Is LLM Gateway open source?",
		answer:
			"Yes — the gateway is licensed under AGPLv3 and free to self-host forever. Portkey's gateway is open source, but its broader LLMOps platform is a proprietary hosted product.",
	},
	{
		question: "How does pricing compare to Portkey?",
		answer:
			"Pay per token at provider rates with a flat 5% platform fee on credits, or bring your own provider keys and pay providers directly for free. There are no per-seat or request-volume tiers.",
	},
	{
		question: "Can I migrate from Portkey without changing my code?",
		answer:
			"Yes. LLM Gateway exposes an OpenAI-compatible API, so you switch by changing the base URL and API key. You get 280+ models across 35+ providers behind that single endpoint.",
	},
	{
		question: "Does LLM Gateway support image and video generation?",
		answer:
			"Yes. Image and video generation are available through the same unified API, alongside chat, embeddings, and tool calling.",
	},
];

export default function ComparePortkeyPage() {
	return (
		<div className="min-h-screen bg-white text-black dark:bg-black dark:text-white">
			<main>
				<HeroCompare
					content={{
						heading: "Looking for a Portkey Alternative?",
						description:
							"Compare LLM Gateway's fully open-source platform, automatic provider routing, and transparent pricing against Portkey's gateway and LLMOps suite.",
						badges: [
							"Fully Open Source",
							"Automatic Routing",
							"Image & Video Gen",
							"Transparent Pricing",
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
				<ComparisonPortkey />
				<CompareFaq
					heading="LLM Gateway vs Portkey"
					description="Common questions about switching from Portkey to LLM Gateway."
					faqs={portkeyFaqs}
				/>
			</main>
			<Footer />
		</div>
	);
}

export async function generateMetadata() {
	return {
		title: "LLM Gateway vs Portkey — The Open Portkey Alternative",
		description:
			"Compare LLM Gateway's fully open-source platform, automatic provider routing, image and video generation, and transparent pricing against Portkey's gateway and LLMOps suite. See why teams pick LLM Gateway as their Portkey alternative.",
		openGraph: {
			title: "LLM Gateway vs Portkey - Feature Comparison",
			description:
				"Compare LLM Gateway's fully open-source platform, automatic provider routing, and transparent pricing against Portkey's gateway and LLMOps suite.",
			type: "website",
		},
		twitter: {
			card: "summary_large_image",
			title: "LLM Gateway vs Portkey - Feature Comparison",
			description:
				"Compare LLM Gateway's fully open-source platform, automatic provider routing, and transparent pricing against Portkey's gateway and LLMOps suite.",
		},
	};
}
