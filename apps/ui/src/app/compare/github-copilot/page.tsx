import { CompareFaq } from "@/components/compare/compare-faq";
import { HeroCompare } from "@/components/compare/hero-compare";
import { ComparisonGitHubCopilot } from "@/components/landing/comparison-github-copilot";
import Footer from "@/components/landing/footer";

import type { CompareFaqItem } from "@/components/compare/compare-faq";

const copilotFaqs: CompareFaqItem[] = [
	{
		question: "Is LLM Gateway a GitHub Copilot alternative?",
		answer:
			"Yes, for chat and agentic coding. LLM Gateway routes any coding agent — Claude Code, Cline, Continue, Aider, or DevPass Code — to 200+ models with zero token markup, hard budget caps, and prompt caching. Copilot remains a fine choice for inline completions, which stay flat-fee.",
	},
	{
		question: "What changed with GitHub Copilot pricing in June 2026?",
		answer:
			"On June 1, 2026, GitHub replaced Premium Request Units with usage-based AI Credits (1 credit = $0.01). Base seats stayed at $10–$39 per user per month, but Copilot Chat, agent mode, code review, and CLI now bill by tokens consumed — with no spending ceiling unless you manually configure a budget.",
	},
	{
		question: "How much does GitHub Copilot cost after the change?",
		answer:
			"The seat price is unchanged — Pro $10, Pro+ $39, Business $19, and Enterprise $39 per user per month — but included credits run out fast under real usage. Heavy chat users on premium models report $150–$250 per month in overages, and agentic teams have projected 10–50x cost increases.",
	},
	{
		question: "How does LLM Gateway keep AI coding costs predictable?",
		answer:
			"Provider token rates pass through with no markup (a flat 5% fee on credits, or 0% with your own provider keys), prompt caching cuts repeat-token spend automatically, and budgets with hard limits can be set per organization, project, and API key — so a runaway agent can never blow the budget.",
	},
	{
		question:
			"Can I keep Copilot for completions and use LLM Gateway for everything else?",
		answer:
			"Yes, that hybrid setup is common: keep a $10 Copilot Pro seat for inline completions, and route chat and agent workloads through LLM Gateway with a flat DevPass plan (from $29/month) or pay-as-you-go usage. You get frontier models at pass-through prices with a hard cap on spend.",
	},
	{
		question: "What are the best GitHub Copilot alternatives in 2026?",
		answer:
			"Teams leaving Copilot's usage billing typically evaluate LLM Gateway with the coding agent of their choice (DevPass Code, Claude Code, Cline, Continue, or Aider), plus flat-fee IDE products like Cursor and Windsurf. The right pick depends on whether you want an editor, an agent, or infrastructure you control.",
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
							"Copilot's June 2026 switch to usage-based AI Credits removed the ceiling on your AI bill. LLM Gateway routes any coding agent to 200+ models with zero token markup, prompt caching, and hard budget caps per team, project, and key.",
						badges: [
							"No Token Markup",
							"Hard Budget Caps",
							"200+ Models",
							"Any Coding Agent",
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
			"Copilot now bills chat and agents by usage-based AI Credits. Compare it with LLM Gateway: zero token markup, hard budget caps, prompt caching, and 200+ models for any coding agent.",
		alternates: { canonical: "/compare/github-copilot" },
		openGraph: {
			title: "LLM Gateway vs GitHub Copilot — Costs Compared (2026)",
			description:
				"Copilot bills chat and agents by usage-based AI Credits. LLM Gateway: zero token markup, hard budget caps, and 200+ models for any coding agent.",
			type: "website",
			url: "https://llmgateway.io/compare/github-copilot",
		},
		twitter: {
			card: "summary_large_image",
			title: "LLM Gateway vs GitHub Copilot — Costs Compared (2026)",
			description:
				"Copilot bills chat and agents by usage-based AI Credits. LLM Gateway: zero token markup, hard budget caps, and 200+ models for any coding agent.",
		},
	};
}
