"use client";
import { Check, X } from "lucide-react";
import Link from "next/link";

import { AuthLink } from "@/components/shared/auth-link";
import { Badge } from "@/lib/components/badge";
import { Button } from "@/lib/components/button";

import { AWSBedrockIcon } from "@llmgateway/shared/components";

const comparisonData = [
	{
		category: "Platform & Lock-in",
		features: [
			{
				title: "Cloud-neutral",
				description: "Use any provider on any cloud — or none at all",
				llmgateway: true,
				bedrock: "AWS only",
			},
			{
				title: "Open source & self-hostable",
				description: "Run the entire platform on your own infrastructure",
				llmgateway: "AGPLv3",
				bedrock: false,
			},
			{
				title: "OpenAI-compatible API",
				description: "One request format across every model",
				llmgateway: true,
				bedrock: "Partial (varies by model)",
			},
			{
				title: "Setup required",
				description: "What you need before your first request",
				llmgateway: "Sign up, copy a key",
				bedrock: "AWS account, IAM, model access",
			},
		],
	},
	{
		category: "Models & Providers",
		features: [
			{
				title: "Providers behind one API",
				description: "Clouds, labs, and fast independent hosts",
				llmgateway: "40+ providers",
				bedrock: "AWS-hosted catalog",
			},
			{
				title: "Frontier model coverage",
				description: "OpenAI, Anthropic, Google, xAI, and more",
				llmgateway: "All major labs",
				bedrock: "No Google Gemini",
			},
			{
				title: "Fast inference hosts",
				description: "Groq, Cerebras, and other speed-focused providers",
				llmgateway: true,
				bedrock: false,
			},
			{
				title: "Image & video generation",
				description: "Generative media through the same API",
				llmgateway: "Across providers",
				bedrock: "Amazon Nova & partners",
			},
		],
	},
	{
		category: "Routing & Reliability",
		features: [
			{
				title: "Automatic provider routing",
				description: "Routes on live uptime, throughput, price, and latency",
				llmgateway: true,
				bedrock: "Cross-region only",
			},
			{
				title: "Failover across providers",
				description:
					"Transparent retry on a healthy provider — even another cloud",
				llmgateway: true,
				bedrock: false,
			},
			{
				title: "Response caching",
				description: "Built-in caching for repeated requests",
				llmgateway: "Redis, 10s–1yr TTL",
				bedrock: "Prompt caching (select models)",
			},
			{
				title: "Route to AWS Bedrock",
				description: "Keep Bedrock in the mix as one provider among many",
				llmgateway: "Built-in provider",
				bedrock: "—",
			},
		],
	},
	{
		category: "Cost & Analytics",
		features: [
			{
				title: "Bring your own keys",
				description: "Use your own provider credentials",
				llmgateway: "0% markup",
				bedrock: "N/A (AWS billing)",
			},
			{
				title: "Transparent platform fee",
				description: "Predictable, easy-to-reason-about pricing",
				llmgateway: "5% or 0% (BYOK)",
				bedrock: "Provider rates via AWS",
			},
			{
				title: "Real-time cost analytics",
				description: "Per-request cost, latency, and usage in one dashboard",
				llmgateway: true,
				bedrock: "CloudWatch / Cost Explorer",
			},
			{
				title: "Guardrails",
				description: "Prompt injection, PII, jailbreak, and secret detection",
				llmgateway: true,
				bedrock: true,
			},
		],
	},
];

export function ComparisonBedrock() {
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
						Every model on Bedrock — plus every model that isn&apos;t
					</h2>
					<p className="text-muted-foreground">
						Compare LLM Gateway and Amazon Bedrock features side by side
					</p>
				</div>

				<div className="mb-8 bg-primary/5 dark:bg-primary/10 rounded-lg p-6 border border-primary/20">
					<h3 className="font-bold text-lg mb-3 text-primary">
						Why choose LLM Gateway?
					</h3>
					<div className="grid md:grid-cols-2 gap-4 text-sm">
						<div className="flex items-start gap-2">
							<Check className="h-4 w-4 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />
							<span className="text-foreground">
								<strong>No cloud lock-in</strong> — Bedrock is one of 40+
								providers behind a single OpenAI-compatible API
							</span>
						</div>
						<div className="flex items-start gap-2">
							<Check className="h-4 w-4 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />
							<span className="text-foreground">
								<strong>Cross-cloud failover</strong> — if a Bedrock region
								degrades, requests retry on another provider automatically
							</span>
						</div>
						<div className="flex items-start gap-2">
							<Check className="h-4 w-4 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />
							<span className="text-foreground">
								<strong>Fully open source</strong> — self-host the entire
								platform under AGPLv3
							</span>
						</div>
						<div className="flex items-start gap-2">
							<Check className="h-4 w-4 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />
							<span className="text-foreground">
								<strong>Keep your Bedrock setup</strong> — bring your AWS
								credentials and route through Bedrock with 0% markup
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
									OPEN-SOURCE & CLOUD-NEUTRAL
								</p>
								<p className="text-2xl font-bold text-primary">From $0</p>
								<p className="text-xs text-muted-foreground mt-1">
									Self-host free forever
								</p>
							</div>
						</div>
						<div className="text-center">
							<div className="border border-border rounded-lg p-4 bg-background h-full">
								<div className="flex justify-center mb-1">
									<AWSBedrockIcon className="h-7 w-auto text-foreground" />
								</div>
								<h3 className="font-bold text-lg mb-1 text-foreground">
									Bedrock
								</h3>
								<p className="text-sm text-muted-foreground mb-2">
									AWS MANAGED AI SERVICE
								</p>
								<p className="text-2xl font-bold text-foreground">
									Usage-based
								</p>
								<p className="text-xs text-muted-foreground mt-1">
									Requires an AWS account
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
									<div className="flex justify-center items-center">
										{renderFeatureValue(feature.llmgateway)}
									</div>
									<div className="flex justify-center items-center">
										{renderFeatureValue(feature.bedrock)}
									</div>
								</div>
							))}
						</div>
					))}
				</div>

				<div className="mt-8 bg-muted/40 rounded-lg p-6 border border-border">
					<h3 className="font-bold text-lg mb-2 text-foreground">
						Already on Bedrock? Keep it — and stop depending on it.
					</h3>
					<p className="text-sm text-muted-foreground">
						AWS Bedrock is a built-in LLM Gateway provider. Bring your AWS
						credentials and your Bedrock traffic keeps flowing with 0% markup —
						while every request gains automatic failover to other providers,
						response caching, guardrails, and per-request cost analytics. When
						you need a model Bedrock doesn&apos;t host, it&apos;s already behind
						the same API.
					</p>
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
							<Link href="/pricing">View Pricing Details</Link>
						</Button>
					</div>
					<p className="text-sm text-muted-foreground mt-3">
						No credit card required • Self-host option available • Enterprise
						support included
					</p>
				</div>
			</div>
		</section>
	);
}
