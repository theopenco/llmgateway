"use client";
import { Check, X } from "lucide-react";
import Link from "next/link";

import { AuthLink } from "@/components/shared/auth-link";
import { Badge } from "@/lib/components/badge";
import { Button } from "@/lib/components/button";

const comparisonData = [
	{
		category: "Deployment & Open Source",
		features: [
			{
				title: "Managed cloud",
				description: "Fully managed, production-ready hosted service",
				llmgateway: true,
				portkey: true,
			},
			{
				title: "Self-host the full platform",
				description: "Run the entire stack on your own infrastructure",
				llmgateway: "AGPLv3",
				portkey: "Gateway only",
			},
			{
				title: "Open-source license",
				description: "What ships under an open-source license",
				llmgateway: "Full platform (AGPLv3)",
				portkey: "Gateway/router (MIT)",
			},
			{
				title: "One-command Docker deploy",
				description: "Single image with dashboard, worker, and gateway",
				llmgateway: true,
				portkey: "Gateway only",
			},
		],
	},
	{
		category: "Routing & Reliability",
		features: [
			{
				title: "Automatic provider scoring",
				description: "Routes on live uptime, throughput, price, and latency",
				llmgateway: true,
				portkey: "Manual config",
			},
			{
				title: "Failover & retries",
				description: "Transparent retry on a healthy provider",
				llmgateway: true,
				portkey: true,
			},
			{
				title: "Load balancing",
				description: "Spread traffic across providers for a model",
				llmgateway: true,
				portkey: true,
			},
			{
				title: "Response caching",
				description: "Built-in caching for repeated requests",
				llmgateway: "Redis, 10s–1yr TTL",
				portkey: "Incl. semantic",
			},
		],
	},
	{
		category: "Cost & Pricing",
		features: [
			{
				title: "Bring your own keys",
				description: "Use your own provider keys",
				llmgateway: "0% markup",
				portkey: true,
			},
			{
				title: "Transparent platform fee",
				description: "Predictable, easy-to-reason-about pricing",
				llmgateway: "5% or 0% (BYOK)",
				portkey: "Usage/seat tiers",
			},
			{
				title: "Real-time cost analytics",
				description: "Per-request cost tracking in the dashboard",
				llmgateway: true,
				portkey: true,
			},
			{
				title: "Free to start",
				description: "Get going without a paid plan",
				llmgateway: "Free self-host",
				portkey: "Free tier (limited)",
			},
		],
	},
	{
		category: "Capabilities",
		features: [
			{
				title: "Model coverage",
				description: "Models and providers available through one API",
				llmgateway: "280+ models, 35+ providers",
				portkey: "1,600+ (vendor claim)",
			},
			{
				title: "Image & video generation",
				description: "Generative media through the same API",
				llmgateway: true,
				portkey: "Limited",
			},
			{
				title: "Guardrails",
				description: "Prompt injection, PII, jailbreak, and secret detection",
				llmgateway: true,
				portkey: true,
			},
			{
				title: "Versioned prompt management",
				description: "Prompt registry, templates, and deployments",
				llmgateway: "Playground only",
				portkey: true,
			},
			{
				title: "OpenTelemetry & deep tracing",
				description: "Export traces into an existing observability stack",
				llmgateway: false,
				portkey: true,
			},
		],
	},
];

export function ComparisonPortkey() {
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
						The best Portkey alternative for teams who want one open platform
					</h2>
					<p className="text-muted-foreground">
						Compare LLM Gateway and Portkey features side by side
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
								<strong>Fully open source</strong> — self-host the entire
								platform, not just the router
							</span>
						</div>
						<div className="flex items-start gap-2">
							<Check className="h-4 w-4 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />
							<span className="text-foreground">
								<strong>Automatic routing</strong> that scores providers on live
								metrics
							</span>
						</div>
						<div className="flex items-start gap-2">
							<Check className="h-4 w-4 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />
							<span className="text-foreground">
								<strong>Image &amp; video generation</strong> through the same
								API
							</span>
						</div>
						<div className="flex items-start gap-2">
							<Check className="h-4 w-4 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />
							<span className="text-foreground">
								<strong>Transparent pricing</strong> — 5% platform fee, or 0%
								with your own keys
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
									OPEN-SOURCE & PRODUCTION-READY
								</p>
								<p className="text-2xl font-bold text-primary">From $0</p>
								<p className="text-xs text-muted-foreground mt-1">
									Self-host free forever
								</p>
							</div>
						</div>
						<div className="text-center">
							<div className="border border-border rounded-lg p-4 bg-background h-full">
								<h3 className="font-bold text-lg mb-1 text-foreground">
									Portkey
								</h3>
								<p className="text-sm text-muted-foreground mb-2">
									GATEWAY + LLMOPS PLATFORM
								</p>
								<p className="text-2xl font-bold text-foreground">
									Usage-based
								</p>
								<p className="text-xs text-muted-foreground mt-1">
									Free tier, then paid plans
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
									className="grid grid-cols-3 gap-4 p-6 border-b border-border/50 hover:bg-muted/30 transition-colors"
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
										{renderFeatureValue(feature.portkey)}
									</div>
								</div>
							))}
						</div>
					))}
				</div>

				<div className="text-center mt-8">
					<div className="flex flex-col sm:flex-row gap-4 justify-center">
						<Button size="lg" className="bg-primary hover:bg-primary/90">
							<AuthLink href="/signup">Start Free with LLM Gateway</AuthLink>
						</Button>
						<Button size="lg" variant="outline">
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
