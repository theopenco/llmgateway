import { CompareFaq } from "@/components/compare/compare-faq";
import { ComparisonSources } from "@/components/compare/comparison-sources";
import { HeroCompare } from "@/components/compare/hero-compare";
import { ComparisonGitHubCopilot } from "@/components/landing/comparison-github-copilot";
import Footer from "@/components/landing/footer";

import type { CompareFaqItem } from "@/components/compare/compare-faq";

const copilotFaqs: CompareFaqItem[] = [
	{
		question: "Is LLM Gateway a replacement for GitHub Copilot?",
		answer:
			"LLM Gateway supplies model access for compatible coding tools. Copilot supplies editor completions, chat, CLI and agent workflows integrated with GitHub. You can use a gateway with supported Copilot BYOK clients rather than replacing the entire coding experience.",
	},
	{
		question: "What does GitHub Copilot cost?",
		answer:
			"Monthly prices are Pro $10, Pro+ $39, Max $100, Business $19 per seat and Enterprise $39 per seat. Current individual allowances total 1,500, 7,000 and 20,000 AI credits, including a variable flex allotment. Business and Enterprise contribute 1,900 and 3,900 credits per seat to a shared pool. One AI credit equals $0.01. Free and Student plans are also available.",
	},
	{
		question: "Can Copilot spending be capped?",
		answer:
			"Yes. Organization and enterprise paid additional usage is enabled by default, but administrators can disable it or configure spending controls. User budgets stop that user at their limit. Individual paid plans require an additional-usage budget to continue beyond included credits. Check whether a broader budget stops usage or only sends alerts.",
	},
	{
		question: "Does Copilot support BYOK and prompt caching?",
		answer:
			"Yes. Supported clients offer local BYOK, and enterprise-managed custom models are in public preview. Feature availability depends on the client and organization policy. Copilot also accounts for cached tokens, so prompt caching is not a gateway-only saving.",
	},
	{
		question: "What stays included without AI-credit billing?",
		answer:
			"Code completions and next-edit suggestions remain unlimited on paid Copilot plans. Chat and agent features consume credits. Compare the tool experience and your actual workload as well as the subscription price.",
	},
	{
		question: "How does LLM Gateway charge for coding usage?",
		answer:
			"Pay-as-you-go usage has no token markup, with a 5% credit-purchase fee or no BYOK platform fee. DevPass is a separate subscription with a monthly allowance and premium weekly fair-use limits. Optional overflow spends additional credits; it is not unlimited flat-fee usage.",
	},
];

export default function CompareGitHubCopilotPage() {
	return (
		<div className="min-h-screen bg-white text-black dark:bg-black dark:text-white">
			<main>
				<HeroCompare
					content={{
						heading: "The Cost-Controlled GitHub Copilot Alternative",
						description:
							"Compare Copilot's integrated coding tools, included AI credits and BYOK support with LLM Gateway's cross-provider API, per-request analytics and organization, project and key budgets.",
						badges: [
							"No Token Markup",
							"Hard Budget Caps",
							"200+ Models",
							"Compatible Coding Tools",
						],
						cta: {
							primary: {
								text: "Start for Free",
								href: "/signup",
							},
							secondary: {
								text: "Estimate Your Copilot Costs",
								href: "/copilot-cost-calculator",
							},
						},
					}}
				/>
				<ComparisonGitHubCopilot />
				<ComparisonSources slug="github-copilot" />
				<CompareFaq
					heading="LLM Gateway vs GitHub Copilot"
					description="Common questions about moving off GitHub Copilot's usage-based billing."
					faqs={copilotFaqs}
				/>
			</main>
			<Footer />
		</div>
	);
}

export async function generateMetadata() {
	return {
		title: "LLM Gateway vs GitHub Copilot — Costs Compared (2026)",
		description:
			"Copilot now bills chat and agents by usage-based AI Credits. Compare it with LLM Gateway: zero token markup, hard budget caps, prompt caching, and 200+ models for compatible coding tools.",
		alternates: { canonical: "/compare/github-copilot" },
		openGraph: {
			title: "LLM Gateway vs GitHub Copilot — Costs Compared (2026)",
			description:
				"Copilot bills chat and agents by usage-based AI Credits. LLM Gateway: zero token markup, hard budget caps, and 200+ models for compatible coding tools.",
			type: "website",
			url: "https://llmgateway.io/compare/github-copilot",
		},
		twitter: {
			card: "summary_large_image",
			title: "LLM Gateway vs GitHub Copilot — Costs Compared (2026)",
			description:
				"Copilot bills chat and agents by usage-based AI Credits. LLM Gateway: zero token markup, hard budget caps, and 200+ models for compatible coding tools.",
		},
	};
}
