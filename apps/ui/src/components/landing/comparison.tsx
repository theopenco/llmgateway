import { Check } from "lucide-react";
import Link from "next/link";

import {
	ComparisonCtas,
	ComparisonTable,
} from "@/components/landing/comparison-table";
import { Badge } from "@/lib/components/badge";

import { MARKETING_STATS } from "@llmgateway/shared";

const comparisonData = [
	{
		category: "Platform & Ownership",
		features: [
			{
				title: "Open-source license",
				description: "What ships under an open-source license",
				llmgateway: "Core (AGPLv3); Enterprise commercial",
				openrouter: false,
			},
			{
				title: "Independent vendor",
				description: "Who sets the roadmap, fees, and terms",
				llmgateway: "Independent",
				openrouter: "Stripe acquisition announced; check closing status",
			},
			{
				title: "Model catalog",
				description: "Models and providers behind one API",
				llmgateway: `${MARKETING_STATS.models} models, ${MARKETING_STATS.providers} providers`,
				openrouter: "See OpenRouter catalog",
			},
		],
	},
	{
		category: "Pricing & Fees",
		features: [
			{
				title: "Credits pricing",
				description: "Pay-as-you-go with credits",
				llmgateway: "Flat 5% fee on credit purchases",
				openrouter: "Standard 5.5%; Business 8%",
			},
			{
				title: "Bring Your Own Keys",
				description: "Use your own provider API keys",
				llmgateway: "Free — pay providers directly",
				openrouter:
					"Standard/Business: $25k allowance; Enterprise: $200k; then 5%",
			},
			{
				title: "Self-hosting option",
				description: "Self-host the core; infrastructure costs are separate",
				llmgateway: "Free core (AGPLv3)",
				openrouter: false,
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
				openrouter: true,
			},
			{
				title: "Latency analytics",
				description: "Real-time performance monitoring",
				llmgateway: true,
				openrouter: "Per-provider stats",
			},
			{
				title: "Request-level insights",
				description: "Granular analytics for each API call",
				llmgateway: true,
				openrouter: true,
			},
			{
				title: "Usage dashboard",
				description: "Comprehensive usage metrics",
				llmgateway: true,
				openrouter: true,
			},
		],
	},
	{
		category: "Reliability & Support",
		features: [
			{
				title: "Uptime SLA",
				description: "Guaranteed uptime for managed instances",
				llmgateway: "99.9% (Enterprise)",
				openrouter: "Enterprise only",
			},
			{
				title: "Failover support",
				description: "Automatic failover to backup providers",
				llmgateway: true,
				openrouter: true,
			},
			{
				title: "Load balancing",
				description: "Distribute requests across providers",
				llmgateway: true,
				openrouter: true,
			},
			{
				title: "Priority support",
				description: "Dedicated support for paid plans",
				llmgateway: "Enterprise",
				openrouter: "Enterprise only",
			},
		],
	},
];

export function Comparison() {
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
						Compare LLM Gateway and OpenRouter features side by side
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
								<strong>Bring Your Own Keys</strong> at no extra cost
							</span>
						</div>
						<div className="flex items-start gap-2">
							<Check className="h-4 w-4 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />
							<span className="text-foreground">
								<strong>Real-time analytics</strong> for cost & latency
								optimization
							</span>
						</div>
						<div className="flex items-start gap-2">
							<Check className="h-4 w-4 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />
							<span className="text-foreground">
								<strong>Can be self hosted</strong> for complete control
							</span>
						</div>
						<div className="flex items-start gap-2">
							<Check className="h-4 w-4 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />
							<span className="text-foreground">
								<strong>99.9% uptime SLA</strong> with enterprise support
							</span>
						</div>
					</div>
				</div>

				<ComparisonTable
					llmgateway={{
						tagline: "OPEN & FLEXIBLE",
						price: "From $0",
						note: "Free core; hosting costs separate",
					}}
					competitor={{
						name: "OpenRouter",
						tagline: "HOSTED MODEL MARKETPLACE",
						price: "From $0",
						note: "Credit-based pricing",
					}}
					competitorKey="openrouter"
					data={comparisonData}
				/>

				<ComparisonCtas>
					<p className="text-sm text-muted-foreground mt-3">
						Weighing more options? See the{" "}
						<Link
							href={"/blog/openrouter-alternatives" as any}
							className="underline underline-offset-4 hover:text-foreground"
						>
							10 best OpenRouter alternatives in 2026
						</Link>
						.
					</p>
				</ComparisonCtas>
			</div>
		</section>
	);
}
