import { Check } from "lucide-react";

import {
	ComparisonCtas,
	ComparisonTable,
} from "@/components/landing/comparison-table";
import { Badge } from "@/lib/components/badge";

import { AWSBedrockIcon } from "@llmgateway/shared/components";

const comparisonData = [
	{
		category: "Platform & Lock-in",
		features: [
			{
				title: "Cloud-neutral",
				description: "Choose from supported providers across clouds",
				llmgateway: true,
				bedrock: "AWS only",
			},
			{
				title: "Open source & self-hostable",
				description:
					"Run the core on your infrastructure; Enterprise has separate terms",
				llmgateway: "AGPLv3",
				bedrock: false,
			},
			{
				title: "OpenAI-compatible API",
				description: "Common request formats; features depend on the model",
				llmgateway: true,
				bedrock: "Chat Completions / Responses; model-dependent",
			},
			{
				title: "Setup required",
				description: "What you need before your first request",
				llmgateway: "Sign up, copy a key",
				bedrock: "AWS account, permissions, eligible model",
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
				bedrock: "AWS-hosted catalog",
			},
			{
				title: "Frontier model coverage",
				description: "Check live catalogs for the models you need",
				llmgateway: "Cross-provider catalog",
				bedrock: "See Bedrock model catalog",
			},
			{
				title: "Fast inference hosts",
				description: "Choose independent inference hosts",
				llmgateway: true,
				bedrock: false,
			},
			{
				title: "Image & video generation",
				description: "Generative media through the same API",
				llmgateway: "Across providers",
				bedrock: "Supported media models",
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
				bedrock: "Cross-region and intelligent prompt routing",
			},
			{
				title: "Failover across providers",
				description: "Retry within the configured model and provider pool",
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
				bedrock: "AWS model, region and service-tier rates",
			},
			{
				title: "Real-time cost analytics",
				description: "Per-request cost, latency, and usage in one dashboard",
				llmgateway: true,
				bedrock: "CloudWatch / Cost Explorer",
			},
			{
				title: "Content guardrails",
				description: "Content checks; coverage and pricing vary by product",
				llmgateway: "Enterprise",
				bedrock: true,
			},
		],
	},
];

export function ComparisonBedrock() {
	return (
		<section className="w-full py-12 md:py-24 lg:py-32 bg-background">
			<div className="container px-4 md:px-6 max-w-5xl mx-auto">
				<div className="text-center mb-12">
					<Badge variant="outline" className="mb-4">
						Compare platforms
					</Badge>
					<h2 className="text-3xl font-bold tracking-tight mb-2 text-foreground">
						Keep Bedrock and add cross-provider routing
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
								<strong>No cloud lock-in</strong> — Bedrock is one of the
								supported providers behind a single OpenAI-compatible API
							</span>
						</div>
						<div className="flex items-start gap-2">
							<Check className="h-4 w-4 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />
							<span className="text-foreground">
								<strong>Cross-cloud failover</strong> — retryable failures can
								fall back to an eligible alternative provider when routing
								settings allow it
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
								<strong>Keep your Bedrock setup</strong> — bring your AWS
								credentials and route through Bedrock with 0% markup
							</span>
						</div>
					</div>
				</div>

				<ComparisonTable
					llmgateway={{
						tagline: "OPEN-SOURCE & CLOUD-NEUTRAL",
						price: "From $0",
						note: "Free core; hosting costs separate",
					}}
					competitor={{
						name: "Bedrock",
						tagline: "AWS MANAGED AI SERVICE",
						price: "Usage-based",
						note: "Requires an AWS account",
						icon: <AWSBedrockIcon className="h-7 w-auto text-foreground" />,
					}}
					competitorKey="bedrock"
					data={comparisonData}
				/>

				<div className="mt-8 bg-muted/40 rounded-lg p-6 border border-border">
					<h3 className="font-bold text-lg mb-2 text-foreground">
						Already on Bedrock? Keep it — and stop depending on it.
					</h3>
					<p className="text-sm text-muted-foreground">
						AWS Bedrock is a built-in LLM Gateway provider. Bring your AWS
						credentials and your Bedrock traffic keeps flowing with 0% markup —
						with configurable provider fallback, response caching, and cost
						analytics. Content guardrails require Enterprise. Check our live
						catalog for supported routes outside Bedrock.
					</p>
				</div>

				<ComparisonCtas />
			</div>
		</section>
	);
}
