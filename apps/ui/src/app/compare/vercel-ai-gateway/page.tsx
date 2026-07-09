import { CompareFaq } from "@/components/compare/compare-faq";
import { HeroCompare } from "@/components/compare/hero-compare";
import { ComparisonVercel } from "@/components/landing/comparison-vercel";
import Footer from "@/components/landing/footer";

import type { CompareFaqItem } from "@/components/compare/compare-faq";

const vercelFaqs: CompareFaqItem[] = [
	{
		question: "Is LLM Gateway a good Vercel AI Gateway alternative?",
		answer:
			"Yes. Both pass provider token rates through with zero markup and offer automatic failover and caching. The difference is portability: LLM Gateway is fully open source (AGPLv3) and self-hostable, and it isn't tied to a Vercel team account or deploy target.",
	},
	{
		question: "Can I self-host LLM Gateway? Vercel AI Gateway is managed-only.",
		answer:
			"Yes. The entire platform — gateway, dashboard, and worker — is AGPLv3 and runs on your own infrastructure with a single Docker image. Vercel AI Gateway is a managed cloud service with no self-host option.",
	},
	{
		question: "Does it work with the Vercel AI SDK?",
		answer:
			"Yes. LLM Gateway ships a first-class AI SDK provider (`@llmgateway/ai-sdk-provider`), so you keep using `generateText` and `streamText` — just point them at LLM Gateway instead of the default gateway.",
	},
	{
		question: "How does pricing compare to Vercel AI Gateway?",
		answer:
			"Both charge no markup on tokens. On the managed tier LLM Gateway adds a flat 5% platform fee on credits, or 0% when you bring your own provider keys. Self-hosting the AGPLv3 build is free, and there are no team-seat or governance add-ons gated behind a higher plan.",
	},
	{
		question: "What can LLM Gateway do that Vercel AI Gateway doesn't?",
		answer:
			"Run on your own infrastructure under an open-source license, generate images and video through the same API, and use built-in guardrails (PII, prompt injection, secrets) without a paid add-on.",
	},
];

export default function CompareVercelPage() {
	return (
		<div className="min-h-screen bg-white text-black dark:bg-black dark:text-white">
			<main>
				<HeroCompare
					content={{
						heading: "The Open Vercel AI Gateway Alternative",
						description:
							"Compare LLM Gateway's open-source, self-hostable platform — with zero token markup, image and video generation, and built-in guardrails — against Vercel AI Gateway's managed, AI SDK-native service.",
						badges: [
							"Fully Open Source",
							"Self-Hostable",
							"Zero Token Markup",
							"No Lock-In",
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
				<ComparisonVercel />
				<CompareFaq
					heading="LLM Gateway vs Vercel AI Gateway"
					description="Common questions about choosing LLM Gateway over Vercel AI Gateway."
					faqs={vercelFaqs}
				/>
			</main>
			<Footer />
		</div>
	);
}

export async function generateMetadata() {
	return {
		title: "LLM Gateway vs Vercel AI Gateway — The Open Alternative",
		description:
			"Compare open-source, self-hostable routing with zero token markup and guardrails vs Vercel AI Gateway's managed AI SDK service.",
		alternates: {
			canonical: "/compare/vercel-ai-gateway",
		},
		openGraph: {
			title: "LLM Gateway vs Vercel AI Gateway — Feature Comparison",
			description:
				"Open-source, self-hostable platform with zero token markup vs Vercel AI Gateway's managed service.",
			type: "website",
			url: "https://llmgateway.io/compare/vercel-ai-gateway",
		},
		twitter: {
			card: "summary_large_image",
			title: "LLM Gateway vs Vercel AI Gateway — Feature Comparison",
			description:
				"Open-source, self-hostable platform with zero token markup vs Vercel AI Gateway's managed service.",
		},
	};
}
