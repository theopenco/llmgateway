import {
	BarChart3,
	Building2,
	Cpu,
	Percent,
	Server,
	TrendingUp,
} from "lucide-react";
import Link from "next/link";

import { Button } from "@/lib/components/button";

const capabilities = [
	{
		icon: TrendingUp,
		title: "Real-Time Metrics",
		description:
			"Track signups, revenue, verified users, and paying customers from a single view. Configurable time ranges from 7 days to all-time.",
	},
	{
		icon: Building2,
		title: "Organization Management",
		description:
			"Search, sort, and drill into every organization. View projects, API keys, transactions, credits, and spending at a glance.",
	},
	{
		icon: Server,
		title: "Provider Monitoring",
		description:
			"Monitor every LLM provider in real time. Track request volume, error rates, cache hit ratios, and average time to first token.",
	},
	{
		icon: Cpu,
		title: "Model Performance",
		description:
			"See which models are being used, how often they fail, and how fast they respond. Filter and sort across hundreds of models instantly.",
	},
	{
		icon: Percent,
		title: "Discount Controls",
		description:
			"Set global or per-organization discounts by provider and model. Full control over pricing without touching code.",
	},
	{
		icon: BarChart3,
		title: "Revenue Analytics",
		description:
			"Interactive charts for signup trends and revenue over time. Spot patterns, track growth, and forecast with confidence.",
	},
];

export function AdminDashboardEnterprise() {
	return (
		<section className="py-20 sm:py-28 border-t border-border">
			<div className="container mx-auto px-4 sm:px-6 lg:px-8">
				<div className="mx-auto max-w-3xl text-center mb-16">
					<div className="mb-4 inline-flex items-center gap-2 rounded-full border border-border bg-muted px-4 py-1.5">
						<span className="text-xs font-mono text-blue-500">SELF-HOSTED</span>
						<span className="text-xs text-muted-foreground">
							Included with every enterprise deployment
						</span>
					</div>
					<h2 className="mb-4 text-3xl font-bold tracking-tight sm:text-4xl lg:text-5xl text-balance">
						A full admin dashboard, on your infrastructure
					</h2>
					<p className="text-lg text-muted-foreground text-balance leading-relaxed">
						When you self-host LLM Gateway, you get a complete admin dashboard
						to monitor, manage, and optimize your entire LLM operation. No
						external dependencies, no data leaving your network.
					</p>
				</div>

				<div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
					{capabilities.map((cap) => (
						<div
							key={cap.title}
							className="group relative rounded-xl border border-border bg-card p-6 transition-all hover:border-blue-500/50 hover:shadow-md hover:shadow-blue-500/5"
						>
							<div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10 text-blue-500 transition-colors group-hover:bg-blue-500/20">
								<cap.icon className="h-5 w-5" />
							</div>
							<h3 className="mb-2 text-lg font-semibold">{cap.title}</h3>
							<p className="text-sm text-muted-foreground leading-relaxed">
								{cap.description}
							</p>
						</div>
					))}
				</div>

				<div className="mt-12 text-center">
					<Button size="lg" variant="outline" asChild>
						<Link href="/enterprise#contact">Request a demo</Link>
					</Button>
				</div>
			</div>
		</section>
	);
}
