import { Check } from "lucide-react";
import Link from "next/link";

import {
	ComparisonCtas,
	ComparisonTable,
} from "@/components/landing/comparison-table";
import { Badge } from "@/lib/components/badge";

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
				title: "Self-hosting options",
				description:
					"Run the core on your infrastructure; Enterprise terms differ",
				llmgateway: "AGPLv3",
				portkey: "OSS gateway; Enterprise private cloud",
			},
			{
				title: "Open-source license",
				description: "What ships under an open-source license",
				llmgateway: "Core (AGPLv3); Enterprise commercial",
				portkey: "Gateway (MIT)",
			},
			{
				title: "One-command Docker deploy",
				description: "Single image with dashboard, worker, and gateway",
				llmgateway: true,
				portkey: "OSS gateway and local console",
			},
			{
				title: "Independent vendor",
				description: "Who sets the roadmap, pricing, and terms",
				llmgateway: "Independent",
				portkey: "Palo Alto Networks (since May 2026)",
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
				portkey: "Configurable routing policies",
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
				portkey: "Simple cache; semantic cache on eligible plans",
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
				portkey: "$49/mo includes 100k logs; $9/100k extra",
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
				portkey: "Free tier (10k logs/mo)",
			},
		],
	},
	{
		category: "Capabilities",
		features: [
			{
				title: "Model coverage",
				description: "Models and providers available through one API",
				llmgateway: "See live model catalog",
				portkey: "See Portkey catalog",
			},
			{
				title: "Image generation",
				description: "Generative media through the same API",
				llmgateway: true,
				portkey: true,
			},
			{
				title: "Content guardrails",
				description: "Content checks; coverage and pricing vary by product",
				llmgateway: "Enterprise",
				portkey: true,
			},
			{
				title: "Versioned prompt management",
				description: "Prompt registry, templates, and deployments",
				llmgateway: "Lounge only",
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
	return (
		<section className="w-full py-12 md:py-24 lg:py-32 bg-background">
			<div className="container px-4 md:px-6 max-w-5xl mx-auto">
				<div className="text-center mb-12">
					<Badge variant="outline" className="mb-4">
						Compare platforms
					</Badge>
					<h2 className="text-3xl font-bold tracking-tight mb-2 text-foreground">
						Compare gateway hosting and prompt operations
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
								<strong>Open-source core</strong> — self-host the gateway,
								dashboard and worker
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

				<ComparisonTable
					llmgateway={{
						tagline: "OPEN-SOURCE & PRODUCTION-READY",
						price: "From $0",
						note: "Free core; hosting costs separate",
					}}
					competitor={{
						name: "Portkey",
						tagline: "NOW PRISMA AIRS AI GATEWAY",
						price: "From $49/mo",
						note: "Free dev tier, then usage overages",
					}}
					competitorKey="portkey"
					data={comparisonData}
				/>

				<ComparisonCtas>
					<p className="text-sm text-muted-foreground mt-3">
						Weighing more options? See the{" "}
						<Link
							href="/blog/portkey-alternatives"
							className="underline underline-offset-4 hover:text-foreground"
						>
							8 best Portkey alternatives in 2026
						</Link>
						.
					</p>
				</ComparisonCtas>
			</div>
		</section>
	);
}
