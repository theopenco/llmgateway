"use client";
import { Check, X } from "lucide-react";
import Link from "next/link";

import { AuthLink } from "@/components/shared/auth-link";
import { Badge } from "@/lib/components/badge";
import { Button } from "@/lib/components/button";

const comparisonData = [
	{
		category: "Deployment & Infrastructure",
		features: [
			{
				title: "Managed infrastructure",
				description: "Fully managed, production-ready deployment",
				llmgateway: true,
				litellm: false,
			},
			{
				title: "Self-hosting option",
				description: "Deploy on your own infrastructure (See license)",
				llmgateway: "Free for non-commercial use",
				litellm: "Open source (MIT)",
			},
			{
				title: "Auto-scaling",
				description: "Automatic scaling based on traffic",
				llmgateway: true,
				litellm: "Manual setup required",
			},
			{
				title: "99.9% uptime SLA",
				description: "Guaranteed uptime for managed instances",
				llmgateway: true,
				litellm: false,
			},
		],
	},
	{
		category: "Analytics & Monitoring",
		features: [
			{
				title: "Real-time cost analytics",
				description: "Detailed cost tracking for every request",
				llmgateway: true,
				litellm: "Basic",
			},
			{
				title: "Latency analytics",
				description: "Real-time performance monitoring with visualizations",
				llmgateway: true,
				litellm: "Basic",
			},
			{
				title: "Request-level insights",
				description: "Granular analytics for each API call",
				llmgateway: true,
				litellm: "Requires custom setup",
			},
			{
				title: "Model usage dashboard",
				description: "Comprehensive model usage metrics and trends",
				llmgateway: true,
				litellm: "Requires integration",
			},
			{
				title: "Cost optimization insights",
				description: "AI-powered recommendations to reduce costs",
				llmgateway: true,
				litellm: false,
			},
		],
	},
	{
		category: "Enterprise Features",
		features: [
			{
				title: "Team collaboration",
				description: "Multi-user access with role-based permissions",
				llmgateway: true,
				litellm: "Requires custom setup",
			},
			{
				title: "Project isolation",
				description: "Separate projects with individual API keys",
				llmgateway: true,
				litellm: "Manual configuration",
			},
			{
				title: "Billing integration",
				description: "Built-in billing with Stripe integration",
				llmgateway: true,
				litellm: false,
			},
			{
				title: "Priority support",
				description: "Dedicated support for paid plans",
				llmgateway: "Pro+",
				litellm: "Community only",
			},
			{
				title: "SSO integration",
				description: "Enterprise single sign-on support",
				llmgateway: "Enterprise",
				litellm: false,
			},
		],
	},
	{
		category: "Developer Experience",
		features: [
			{
				title: "OpenAI-compatible API",
				description: "Drop-in replacement for OpenAI API",
				llmgateway: true,
				litellm: true,
			},
			{
				title: "Interactive playground",
				description: "Test models directly in the browser",
				llmgateway: true,
				litellm: false,
			},
			{
				title: "API key management",
				description: "Create and manage multiple API keys",
				llmgateway: true,
				litellm: "Basic",
			},
			{
				title: "Request caching",
				description: "Built-in Redis caching for responses",
				llmgateway: true,
				litellm: "Manual setup required",
			},
			{
				title: "Comprehensive docs",
				description: "Detailed documentation and guides",
				llmgateway: true,
				litellm: true,
			},
		],
	},
];

export function ComparisonLiteLLM() {
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
						Find the perfect fit
					</h2>
					<p className="text-muted-foreground">
						Compare LLM Gateway and LiteLLM features side by side
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
								<strong>Managed infrastructure</strong> with 99.9% uptime SLA
							</span>
						</div>
						<div className="flex items-start gap-2">
							<Check className="h-4 w-4 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />
							<span className="text-foreground">
								<strong>Advanced analytics</strong> with cost optimization
								insights
							</span>
						</div>
						<div className="flex items-start gap-2">
							<Check className="h-4 w-4 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />
							<span className="text-foreground">
								<strong>Enterprise-ready</strong> with team collaboration &amp;
								SSO
							</span>
						</div>
						<div className="flex items-start gap-2">
							<Check className="h-4 w-4 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />
							<span className="text-foreground">
								<strong>Production-tested</strong> with built-in monitoring
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
									MANAGED & PRODUCTION-READY
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
									LiteLLM
								</h3>
								<p className="text-sm text-muted-foreground mb-2">
									SELF-HOSTED ONLY
								</p>
								<p className="text-2xl font-bold text-foreground">Free</p>
								<p className="text-xs text-muted-foreground mt-1">
									Open source (MIT)
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
										{renderFeatureValue(feature.litellm)}
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
							<Link href="/#pricing">View Pricing Details</Link>
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
