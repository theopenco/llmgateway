import { Check, X } from "lucide-react";
import Link from "next/link";

import { AuthLink } from "@/components/shared/auth-link";
import { Badge } from "@/lib/components/badge";
import { Button } from "@/lib/components/button";

import { AzureIcon } from "@llmgateway/shared/components";

const comparisonData = [
	{
		category: "Platform & Lock-in",
		features: [
			{
				title: "Cloud-neutral",
				description: "Choose from supported providers across clouds",
				llmgateway: true,
				foundry: "Azure only",
			},
			{
				title: "Open source & self-hostable",
				description:
					"Run the core on your infrastructure; Enterprise has separate terms",
				llmgateway: "AGPLv3",
				foundry: false,
			},
			{
				title: "OpenAI-compatible API",
				description: "Common request formats; features depend on the model",
				llmgateway: true,
				foundry: "Varies by model",
			},
			{
				title: "Setup required",
				description: "What you need before your first request",
				llmgateway: "Sign up, copy a key",
				foundry: "Azure subscription, resource, deployments",
			},
		],
	},
	{
		category: "Models & Providers",
		features: [
			{
				title: "Providers behind one API",
				description: "Clouds, labs, and fast independent hosts",
				llmgateway: "See live provider catalog",
				foundry: "See Foundry model catalog",
			},
			{
				title: "Frontier model coverage",
				description: "Check live catalogs for the models you need",
				llmgateway: "Cross-provider catalog",
				foundry: "See Foundry model catalog",
			},
			{
				title: "Fast inference hosts",
				description: "Choose independent inference hosts",
				llmgateway: true,
				foundry: false,
			},
			{
				title: "Deployment requirements",
				description: "Setup depends on the billing and provider route",
				llmgateway: "Managed routes; BYOK keeps provider requirements",
				foundry: "Deployments + TPM quotas",
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
				foundry: "Model router with automatic fallback",
			},
			{
				title: "Failover across providers",
				description: "Retry within the configured model and provider pool",
				llmgateway: true,
				foundry: "Fallback within Foundry's supported pool",
			},
			{
				title: "Response caching",
				description: "Built-in caching for repeated requests",
				llmgateway: "Redis, 10s–1yr TTL",
				foundry: "Prompt caching (select models)",
			},
			{
				title: "Route to Azure",
				description: "Keep Azure OpenAI and Foundry models in the mix",
				llmgateway: "Built-in providers",
				foundry: "—",
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
				foundry: "N/A (Azure billing)",
			},
			{
				title: "Transparent platform fee",
				description: "Predictable, easy-to-reason-about pricing",
				llmgateway: "5% or 0% (BYOK)",
				foundry: "Usage-based or provisioned; service charges vary",
			},
			{
				title: "Real-time cost analytics",
				description: "Per-request cost, latency, and usage in one dashboard",
				llmgateway: true,
				foundry: "Azure Monitor / Cost Management",
			},
			{
				title: "Content guardrails",
				description: "Content checks; coverage and pricing vary by product",
				llmgateway: "Enterprise",
				foundry: true,
			},
		],
	},
];

export function ComparisonAzureFoundry() {
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
						Compare cross-provider routing and Azure-native tooling
					</h2>
					<p className="text-muted-foreground">
						Compare LLM Gateway and Microsoft Foundry (formerly Azure AI
						Foundry) features side by side
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
								<strong>No cloud lock-in</strong> — Azure is one of the
								supported providers behind a single OpenAI-compatible API
							</span>
						</div>
						<div className="flex items-start gap-2">
							<Check className="h-4 w-4 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />
							<span className="text-foreground">
								<strong>Managed model access</strong> — use credits for
								supported routes; Azure BYOK still follows deployment quotas
							</span>
						</div>
						<div className="flex items-start gap-2">
							<Check className="h-4 w-4 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />
							<span className="text-foreground">
								<strong>Open-source core</strong> — self-host under AGPLv3;
								enterprise features have separate terms
							</span>
						</div>
						<div className="flex items-start gap-2">
							<Check className="h-4 w-4 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />
							<span className="text-foreground">
								<strong>Keep your Azure setup</strong> — bring your Azure
								credentials and route through Foundry with 0% markup
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
									Free core; hosting costs separate
								</p>
							</div>
						</div>
						<div className="text-center">
							<div className="border border-border rounded-lg p-4 bg-background h-full">
								<div className="flex justify-center mb-1">
									<AzureIcon className="h-7 w-7" />
								</div>
								<h3 className="font-bold text-lg mb-1 text-foreground">
									Microsoft Foundry
								</h3>
								<p className="text-sm text-muted-foreground mb-2">
									FORMERLY AZURE AI FOUNDRY
								</p>
								<p className="text-2xl font-bold text-foreground">
									Usage-based
								</p>
								<p className="text-xs text-muted-foreground mt-1">
									Requires an Azure subscription
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
										{renderFeatureValue(feature.foundry)}
									</div>
								</div>
							))}
						</div>
					))}
				</div>

				<div className="mt-8 bg-muted/40 rounded-lg p-6 border border-border">
					<h3 className="font-bold text-lg mb-2 text-foreground">
						Already on Azure? Keep it — and stop depending on it.
					</h3>
					<p className="text-sm text-muted-foreground">
						Azure OpenAI and Microsoft Foundry are built-in LLM Gateway
						providers. Bring your Azure credentials and your traffic keeps
						flowing with 0% markup — with configurable provider fallback,
						response caching, and cost analytics. Content guardrails require
						Enterprise. Check our live catalog for supported routes outside
						Foundry.
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
						support available
					</p>
				</div>
			</div>
		</section>
	);
}
