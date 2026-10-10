import { CompareFaq } from "@/components/compare/compare-faq";
import { ComparisonSources } from "@/components/compare/comparison-sources";
import { HeroCompare } from "@/components/compare/hero-compare";
import { Comparison } from "@/components/landing/comparison";
import Footer from "@/components/landing/footer";

import type { CompareFaqItem } from "@/components/compare/compare-faq";

const openRouterFaqs: CompareFaqItem[] = [
	{
		question: "How is LLM Gateway different from OpenRouter?",
		answer:
			"Both offer routing, fallback, usage analytics and provider keys. LLM Gateway adds an AGPLv3 core you can self-host and no BYOK platform fee. OpenRouter is a hosted marketplace with workspaces, spend controls and plan-dependent regional routing.",
	},
	{
		question: "How does OpenRouter pricing work?",
		answer:
			"OpenRouter lists a 5.5% platform fee on Standard and 8% on Business, with negotiated Enterprise terms. Standard and Business include a monthly BYOK allowance covering $25,000 of list-price inference; Enterprise includes $200,000. Above that allowance, the BYOK fee is 5% of equivalent OpenRouter inference cost.",
	},
	{
		question: "How does LLM Gateway pricing compare?",
		answer:
			"LLM Gateway charges a 5% fee on credit purchases and no platform fee on your own provider keys. Model usage and optional request storage are separate. Compare the current pricing pages for payment fees, enterprise terms and storage charges.",
	},
	{
		question: "What has OpenRouter added recently?",
		answer:
			"Its Business plan includes US and EU in-region routing and workload identity federation. It also offers a Batch API, media generation and configurable data policies. Check the linked documentation for model eligibility and regional restrictions.",
	},
	{
		question: "Can I migrate without rewriting my application?",
		answer:
			"OpenAI-compatible chat calls usually need a new base URL, API key and model ID. Translate OpenRouter-specific provider preferences, presets, plugins and routing parameters, then test streaming and tool calls before switching production traffic.",
	},
	{
		question: "What is the status of the Stripe acquisition?",
		answer:
			"OpenRouter announced on August 19, 2026 that it had agreed to join Stripe. Treat the announcement separately from a confirmed closing; check the vendor announcement and current contract terms when assessing ownership.",
	},
];

export default function CompareOpenRouterPage() {
	return (
		<div className="min-h-screen bg-white text-black dark:bg-black dark:text-white">
			<main>
				<HeroCompare />
				<Comparison />
				<ComparisonSources slug="open-router" />
				<CompareFaq
					heading="LLM Gateway vs OpenRouter"
					description="Common questions about switching from OpenRouter to LLM Gateway."
					faqs={openRouterFaqs}
				/>
			</main>
			<Footer />
		</div>
	);
}

export async function generateMetadata() {
	return {
		title: "LLM Gateway vs OpenRouter — Feature Comparison",
		description:
			"Compare routing, analytics, and cost optimization vs OpenRouter. See why teams choose a unified API gateway for production LLMs.",
		alternates: { canonical: "/compare/open-router" },
		openGraph: {
			title: "LLM Gateway vs OpenRouter — Feature Comparison",
			description:
				"Compare routing, analytics, and cost optimization vs OpenRouter. See why teams choose a unified API gateway for production LLMs.",
			type: "website",
			url: "https://llmgateway.io/compare/open-router",
		},
		twitter: {
			card: "summary_large_image",
			title: "LLM Gateway vs OpenRouter — Feature Comparison",
			description:
				"Compare routing, analytics, and cost optimization vs OpenRouter for production LLMs.",
		},
	};
}
