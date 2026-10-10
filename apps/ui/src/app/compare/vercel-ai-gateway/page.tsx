import { CompareFaq } from "@/components/compare/compare-faq";
import { ComparisonSources } from "@/components/compare/comparison-sources";
import { HeroCompare } from "@/components/compare/hero-compare";
import { ComparisonVercel } from "@/components/landing/comparison-vercel";
import Footer from "@/components/landing/footer";

import type { CompareFaqItem } from "@/components/compare/compare-faq";

const vercelFaqs: CompareFaqItem[] = [
	{
		question: "Do I need to host my application on Vercel?",
		answer:
			"No. Vercel AI Gateway works from other hosts using an API key and supports the AI SDK plus OpenAI- and Anthropic-compatible interfaces. LLM Gateway also works across hosts. The deployment difference is that LLM Gateway has a self-hostable core, while Vercel operates its gateway as a managed service.",
	},
	{
		question: "How does pricing compare?",
		answer:
			"Vercel offers $5 monthly free credit for eligible models. Buying credits moves you to its paid gateway tier, enables BYOK and ends the monthly free allowance. Inference and BYOK have zero gateway markup. LLM Gateway charges 5% on credit purchases and no BYOK platform fee, with optional storage billed separately.",
	},
	{
		question: "Which Vercel features have extra charges?",
		answer:
			"Custom reporting, team-wide provider allowlists and team-wide zero data retention have separate meters. Trace Drains charge for both trace events and data egress. Plan eligibility also varies. Per-request provider filtering is free; per-request ZDR has no surcharge on eligible Vercel plans.",
	},
	{
		question: "Does Vercel support media generation and budgets?",
		answer:
			"Yes. It supports image generation and beta video and audio capabilities. Budgets can cap team, project, API-key and user spend, but Vercel documents BYOK spend separately from budget enforcement. These capabilities should not be presented as exclusive to LLM Gateway.",
	},
	{
		question: "What can I self-host with LLM Gateway?",
		answer:
			"The core gateway, dashboard and worker are available under AGPLv3. Enterprise controls use a separate commercial license. Built-in content guardrails are an Enterprise feature; provider filtering and retention policies are different controls.",
	},
	{
		question: "Can I keep the AI SDK?",
		answer:
			"Yes. Use the LLM Gateway AI SDK provider or its gateway-compatible endpoint. Review Vercel-specific provider options, routing rules and observability settings during migration.",
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
							"Compare LLM Gateway's open-source, self-hostable platform — with zero token markup, image and video generation, and Enterprise guardrails — against Vercel AI Gateway's managed, AI SDK-native service.",
						badges: [
							"Open-Source Core",
							"Self-Hostable",
							"Zero Token Markup",
							"Self-Hosting Option",
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
				<ComparisonSources slug="vercel-ai-gateway" />
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
			"Compare open-source, self-hostable routing with zero token markup and Enterprise guardrails vs Vercel AI Gateway's managed AI SDK service.",
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
