"use client";
import { Check, X } from "lucide-react";
import Link from "next/link";

import { AuthLink } from "@/components/shared/auth-link";
import { Badge } from "@/lib/components/badge";
import { Button } from "@/lib/components/button";

import type { Route } from "next";

const comparisonData = [
	{
		category: "Pricing & Cost Control",
		features: [
			{
				title: "Token markup",
				description: "What you pay on top of provider token rates",
				llmgateway: "0% markup (5% fee on credits, 0% with your own keys)",
				copilot: "Metered AI Credits at $0.01 each, varies by model",
			},
			{
				title: "Spending ceiling",
				description: "Hard caps so usage can never run away",
				llmgateway: "Budgets and hard limits per org, project, and API key",
				copilot: "Off by default — manual budget in billing settings",
			},
			{
				title: "Prompt caching",
				description: "Automatic caching that cuts repeat-token spend",
				llmgateway: true,
				copilot: false,
			},
			{
				title: "Flat-fee coding plans",
				description: "Predictable monthly pricing for coding agents",
				llmgateway: "DevPass from $29/month",
				copilot: "Base seat only — chat and agents billed by usage",
			},
			{
				title: "Free option",
				description: "Use it without paying anything",
				llmgateway: "Self-host free (AGPLv3)",
				copilot: "2,000 completions/month",
			},
		],
	},
	{
		category: "Model Access",
		features: [
			{
				title: "Model catalog",
				description: "Models available through one interface",
				llmgateway: "200+ models from 40+ providers",
				copilot: "Curated list, GitHub-selected",
			},
			{
				title: "Bring your own provider keys",
				description: "Use existing OpenAI/Anthropic/Google contracts",
				llmgateway: true,
				copilot: false,
			},
			{
				title: "Automatic routing & fallback",
				description: "Requests fail over to healthy providers",
				llmgateway: true,
				copilot: false,
			},
			{
				title: "New model availability",
				description: "How fast frontier models land",
				llmgateway: "Day-one for most providers",
				copilot: "On GitHub's rollout schedule",
			},
		],
	},
	{
		category: "Tooling & Workflow",
		features: [
			{
				title: "Inline IDE completions",
				description: "Ghost-text autocomplete in the editor",
				llmgateway: "Via compatible plugins (Continue, Cline)",
				copilot: "Best-in-class, still flat-fee",
			},
			{
				title: "Works with any coding agent",
				description: "Claude Code, Cline, Continue, Aider, DevPass Code",
				llmgateway: true,
				copilot: "Copilot only",
			},
			{
				title: "OpenAI-compatible API",
				description: "Power your own products and internal tools",
				llmgateway: true,
				copilot: false,
			},
			{
				title: "GitHub PR integration",
				description: "Native pull request summaries and review",
				llmgateway: "Via CI with any model",
				copilot: true,
			},
		],
	},
	{
		category: "Enterprise & Governance",
		features: [
			{
				title: "Per-project spend analytics",
				description: "Cost, latency, and usage for every request",
				llmgateway: true,
				copilot: "Org-level usage reports",
			},
			{
				title: "Team & project isolation",
				description: "Separate keys, budgets, and reporting per team",
				llmgateway: true,
				copilot: "Per-seat licensing",
			},
			{
				title: "Self-hosting & data control",
				description: "Run the whole platform on your infrastructure",
				llmgateway: true,
				copilot: false,
			},
			{
				title: "SSO integration",
				description: "Enterprise single sign-on support",
				llmgateway: "Enterprise",
				copilot: "Enterprise",
			},
			{
				title: "Vendor lock-in",
				description: "How hard it is to leave",
				llmgateway: "None — open source, standard API",
				copilot: "Tied to GitHub ecosystem",
			},
		],
	},
];

export function ComparisonGitHubCopilot() {
	const renderFeatureValue = (value: boolean | string) => {
		if (typeof value === "boolean") {
			return value ? (
				<Check className="h-5 w-5 text-green-600 dark:text-green-400" />
			) : (
				<X className="h-5 w-5 text-red-600 dark:text-red-400" />
			);
		}
		return <span className="text-sm font-medium text-foreground">{value}</span>;
	};

	return (
		<section className="w-full py-12 md:py-24 lg:py-32 bg-background">
			<div className="container px-4 md:px-6 max-w-5xl mx-auto">
				<div className="text-center mb-12">
					<Badge variant="outline" className="mb-4">
						Compare platforms
					</Badge>
					<h2 className="text-3xl font-bold tracking-tight mb-2 text-foreground">
						Own your AI spend
					</h2>
					<p className="text-muted-foreground">
						Compare LLM Gateway and GitHub Copilot side by side after Copilot's
						June 2026 move to usage-based AI Credits
					</p>
				</div>

				<div className="mb-8 bg-primary/5 dark:bg-primary/10 rounded-lg p-6 border border-primary/20">
					<h3 className="font-bold text-lg mb-3 text-primary">
						Why teams switch after the token-billing change
					</h3>
					<div className="grid md:grid-cols-2 gap-4 text-sm">
						<div className="flex items-start gap-2">
							<Check className="h-4 w-4 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />
							<span className="text-foreground">
								<strong>No token markup</strong> — provider rates pass straight
								through
							</span>
						</div>
						<div className="flex items-start gap-2">
							<Check className="h-4 w-4 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />
							<span className="text-foreground">
								<strong>Hard budget caps</strong> per org, project, and API key
							</span>
						</div>
						<div className="flex items-start gap-2">
							<Check className="h-4 w-4 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />
							<span className="text-foreground">
								<strong>Any coding agent</strong> — Claude Code, Cline,
								Continue, Aider, DevPass Code
							</span>
						</div>
						<div className="flex items-start gap-2">
							<Check className="h-4 w-4 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />
							<span className="text-foreground">
								<strong>Prompt caching built in</strong> to cut repeat-token
								spend
							</span>
						</div>
					</div>
				</div>

				<div className="bg-card rounded-lg border border-border overflow-hidden shadow-sm">
					<div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 sm:p-6 bg-muted/50 border-b border-border">
						<div className="hidden md:block" />
						<div className="text-center">
							<div className="border-2 border-primary rounded-lg p-4 bg-background shadow-sm h-full">
								<h3 className="font-bold text-lg mb-1 text-foreground">
									LLM Gateway
								</h3>
								<p className="text-sm text-muted-foreground mb-2">
									OPEN AI GATEWAY
								</p>
								<p className="text-2xl font-bold text-primary">From $0</p>
								<p className="text-xs text-muted-foreground mt-1">
									No token markup • self-host free
								</p>
							</div>
						</div>
						<div className="text-center">
							<div className="border border-border rounded-lg p-4 bg-background h-full">
								<h3 className="font-bold text-lg mb-1 text-foreground">
									GitHub Copilot
								</h3>
								<p className="text-sm text-muted-foreground mb-2">
									SEAT + METERED AI CREDITS
								</p>
								<p className="text-2xl font-bold text-foreground">
									$10–$39/user
								</p>
								<p className="text-xs text-muted-foreground mt-1">
									Plus usage-billed AI Credits
								</p>
							</div>
						</div>
					</div>

					{comparisonData.map((category, categoryIndex) => (
						<div key={categoryIndex}>
							{categoryIndex > 0 && (
								<div className="border-t-2 border-border/50" />
							)}

							{category.features.map((feature, featureIndex) => (
								<div
									key={featureIndex}
									className="grid grid-cols-1 md:grid-cols-3 gap-4 p-6 border-b border-border/50 hover:bg-muted/30 transition-colors"
								>
									<div>
										<h4 className="font-semibold text-foreground mb-1">
											{feature.title}
										</h4>
										<p className="text-sm text-muted-foreground">
											{feature.description}
										</p>
									</div>
									<div className="flex items-center gap-2 md:justify-center">
										<span className="text-xs font-medium text-muted-foreground md:hidden">
											LLM Gateway:
										</span>
										{renderFeatureValue(feature.llmgateway)}
									</div>
									<div className="flex items-center gap-2 md:justify-center">
										<span className="text-xs font-medium text-muted-foreground md:hidden">
											GitHub Copilot:
										</span>
										{renderFeatureValue(feature.copilot)}
									</div>
								</div>
							))}
						</div>
					))}
				</div>

				<div className="text-center mt-8">
					<div className="flex flex-col sm:flex-row gap-4 justify-center">
						<Button
							asChild
							size="lg"
							className="bg-primary hover:bg-primary/90"
						>
							<AuthLink href="/signup">Start Free with LLM Gateway</AuthLink>
						</Button>
						<Button asChild size="lg" variant="outline">
							<Link href={"/copilot-cost-calculator" as Route}>
								Estimate Your Copilot Costs
							</Link>
						</Button>
					</div>
					<p className="text-sm text-muted-foreground mt-3">
						No credit card required • Self-host option available • Enterprise
						support included
					</p>
					<p className="text-sm text-muted-foreground mt-3">
						Weighing more options? See the{" "}
						<Link
							href={"/blog/github-copilot-alternatives" as Route}
							className="underline underline-offset-4 hover:text-foreground"
						>
							best GitHub Copilot alternatives in 2026
						</Link>{" "}
						or the{" "}
						<Link
							href={"/migration/github-copilot" as Route}
							className="underline underline-offset-4 hover:text-foreground"
						>
							GitHub Copilot migration guide
						</Link>
						.
					</p>
				</div>
			</div>
		</section>
	);
}
