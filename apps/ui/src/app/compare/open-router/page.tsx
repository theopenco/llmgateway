import { CompareFaq } from "@/components/compare/compare-faq";
import { HeroCompare } from "@/components/compare/hero-compare";
import { Comparison } from "@/components/landing/comparison";
import Footer from "@/components/landing/footer";

import { MARKETING_STATS } from "@llmgateway/shared";

import type { CompareFaqItem } from "@/components/compare/compare-faq";

const openRouterFaqs: CompareFaqItem[] = [
	{
		question: "How is LLM Gateway different from OpenRouter?",
		answer:
			"LLM Gateway adds full self-hosting under an AGPLv3 license, real-time cost and latency analytics for every request, free Bring Your Own Keys at any volume, and flexible enterprise add-ons — and it is independently owned. OpenRouter is a hosted, closed-source marketplace that cannot run on your own infrastructure, and it is being acquired by Stripe.",
	},
	{
		question: "Is LLM Gateway open source and self-hostable?",
		answer:
			"Yes. The gateway is AGPLv3 licensed and can run entirely on your own infrastructure, free forever — or you can use the managed hosted version.",
	},
	{
		question: "How does pricing compare to OpenRouter?",
		answer: `Use pay-as-you-go credits with a flat 5% platform fee, or bring your own provider keys and pay providers directly for free. Token pricing matches provider rates with no markup, and optional full data retention is billed at ${MARKETING_STATS.dataStoragePrice}.`,
	},
	{
		question: "Does OpenRouter charge a token markup?",
		answer:
			"No. Like LLM Gateway, OpenRouter passes provider list prices through. Its fee is 5.5% on card credit purchases ($0.80 minimum) or 5% on crypto, and bringing your own keys is free up to $25,000 of list-price inference per month ($200,000 on enterprise) before a 5% fee applies. LLM Gateway charges a flat 5% on credits and 0% with your own keys at any volume.",
	},
	{
		question: "Which models and providers are supported?",
		answer: `${MARKETING_STATS.models} models across ${MARKETING_STATS.providers} providers — including GPT, Claude, Gemini, Llama, and Mistral — with new releases typically added within 48 hours of launch. OpenRouter lists 400+ models from 80+ providers, so if you depend on a niche model, check both catalogs before switching.`,
	},
	{
		question: "Can I switch from OpenRouter easily?",
		answer:
			"Yes. LLM Gateway is OpenAI-compatible, so you migrate by swapping the base URL and API key — no code rewrite required.",
	},
	{
		question: "Does Stripe's acquisition of OpenRouter change this comparison?",
		answer:
			"Not the facts on this page. Stripe and OpenRouter announced on August 19, 2026 that Stripe will acquire OpenRouter (reported at more than $7 billion), subject to customary closing conditions. OpenRouter says nothing changes for customers — same name, product, pricing, and roadmap — and the API, the 5.5% credit fee, and the catalog are unchanged as of September 2026. What changes is who sets them next. Regulated teams should verify with the vendor which legal entity is the counterparty after close, and whether the sub-processor list, retention terms, or transfer mechanism change, before updating a DPA or vendor record. We keep a running write-up, including a portability checklist that applies to any gateway, at /blog/stripe-openrouter-acquisition.",
	},
];

export default function CompareOpenRouterPage() {
	return (
		<div className="min-h-screen bg-white text-black dark:bg-black dark:text-white">
			<main>
				<HeroCompare />
				<Comparison />
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
