import { CompareFaq } from "@/components/compare/compare-faq";
import { ComparisonSources } from "@/components/compare/comparison-sources";
import { HeroCompare } from "@/components/compare/hero-compare";
import { ComparisonPortkey } from "@/components/landing/comparison-portkey";
import Footer from "@/components/landing/footer";

import type { CompareFaqItem } from "@/components/compare/compare-faq";

const portkeyFaqs: CompareFaqItem[] = [
	{
		question: "Can both platforms be self-hosted?",
		answer:
			"Yes. Portkey publishes an MIT-licensed gateway and offers enterprise private-cloud deployments. LLM Gateway publishes its core under AGPLv3, with enterprise features under a separate commercial license. Compare the exact edition and included controls before choosing.",
	},
	{
		question: "How much does Portkey cost?",
		answer:
			"Portkey lists a free Developer tier with 10,000 recorded logs per month. Production is $49 per month with 100,000 logs, plus $9 per additional 100,000 requests up to its published tier limit. Production retains logs for 30 days and metrics for 90 days. Enterprise pricing is custom; model-provider charges are separate.",
	},
	{
		question: "How does LLM Gateway pricing differ?",
		answer:
			"LLM Gateway charges a 5% fee on credit purchases, or no platform fee with your own provider keys. Full request storage is an Enterprise feature billed separately, and enterprise controls have their own plan terms. Portkey prices its hosted platform around recorded request volume.",
	},
	{
		question: "What does Portkey offer beyond routing?",
		answer:
			"Portkey combines fallback and load balancing with prompt versioning, observability, semantic caching, guardrail integrations and an MCP gateway. It is worth evaluating when prompt operations and agent governance are central requirements.",
	},
	{
		question: "What changed after the acquisition?",
		answer:
			"Palo Alto Networks completed its acquisition of Portkey on May 29, 2026 and announced integration into Prisma AIRS. Portkey still publishes self-service pricing and open-source gateway code; the acquisition does not mean every deployment requires an enterprise sales contract.",
	},
	{
		question: "What needs to change when migrating?",
		answer:
			"Start with the OpenAI-compatible API, then map model IDs and replace Portkey-specific headers, configs, prompt IDs, caching and guardrail settings. A base URL change alone does not migrate those platform features.",
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
							"Compare LLM Gateway's open-source core, automatic provider routing, and transparent pricing against Portkey — now part of Palo Alto Networks.",
						badges: [
							"Open-Source Core",
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
				<ComparisonSources slug="portkey" />
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
			"Compare open-source routing, image and video generation, and transparent pricing vs Portkey, now part of Palo Alto Networks.",
		alternates: { canonical: "/compare/portkey" },
		openGraph: {
			title: "LLM Gateway vs Portkey — Feature Comparison",
			description:
				"Open-source routing and transparent pricing vs Portkey's gateway and LLMOps suite.",
			type: "website",
			url: "https://llmgateway.io/compare/portkey",
		},
		twitter: {
			card: "summary_large_image",
			title: "LLM Gateway vs Portkey — Feature Comparison",
			description:
				"Open-source routing and transparent pricing vs Portkey's gateway and LLMOps suite.",
		},
	};
}
