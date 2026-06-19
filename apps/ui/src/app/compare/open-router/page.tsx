import { CompareFaq } from "@/components/compare/compare-faq";
import { HeroCompare } from "@/components/compare/hero-compare";
import { Comparison } from "@/components/landing/comparison";
import Footer from "@/components/landing/footer";

import type { CompareFaqItem } from "@/components/compare/compare-faq";

const openRouterFaqs: CompareFaqItem[] = [
	{
		question: "How is LLM Gateway different from OpenRouter?",
		answer:
			"LLM Gateway adds full self-hosting under an AGPLv3 license, deeper real-time cost and latency analytics for every request, free Bring Your Own Keys, and flexible enterprise add-ons. OpenRouter is a hosted proxy only and cannot be run on your own infrastructure.",
	},
	{
		question: "Is LLM Gateway open source and self-hostable?",
		answer:
			"Yes. The gateway is AGPLv3 licensed and can run entirely on your own infrastructure, free forever — or you can use the managed hosted version.",
	},
	{
		question: "How does pricing compare to OpenRouter?",
		answer:
			"Use pay-as-you-go credits with a flat 5% platform fee, or bring your own provider keys and pay providers directly for free. Token pricing matches provider rates with no markup.",
	},
	{
		question: "Which models and providers are supported?",
		answer:
			"280+ models across 35+ providers — including GPT, Claude, Gemini, Llama, and Mistral — with new releases typically added within 48 hours of launch.",
	},
	{
		question: "Can I switch from OpenRouter easily?",
		answer:
			"Yes. LLM Gateway is OpenAI-compatible, so you migrate by swapping the base URL and API key — no code rewrite required.",
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
			"Compare LLM Gateway's advanced routing, analytics, and cost optimization features against OpenRouter's basic proxy service. See why developers choose our unified API gateway for production LLM applications.",
		openGraph: {
			title: "LLM Gateway vs OpenRouter - Feature Comparison",
			description:
				"Compare LLM Gateway's advanced routing, analytics, and cost optimization features against OpenRouter's basic proxy service. See why developers choose our unified API gateway for production LLM applications.",
			type: "website",
		},
		twitter: {
			card: "summary_large_image",
			title: "LLM Gateway vs OpenRouter - Feature Comparison",
			description:
				"Compare LLM Gateway's advanced routing, analytics, and cost optimization features against OpenRouter's basic proxy service.",
		},
	};
}
