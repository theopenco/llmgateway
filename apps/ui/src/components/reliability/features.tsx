import {
	Activity,
	BarChart3,
	Globe,
	LineChart,
	Shield,
	Timer,
} from "lucide-react";

const features = [
	{
		icon: Activity,
		title: "Real-time health checks",
		description:
			"Every provider is continuously probed. Unhealthy endpoints are taken out of rotation within seconds.",
		accent: "text-emerald-500 bg-emerald-500/10",
	},
	{
		icon: Timer,
		title: "Smart routing by latency",
		description:
			"Requests go to the fastest responsive provider for your region. TTFT is tracked per provider, per model.",
		accent: "text-blue-500 bg-blue-500/10",
	},
	{
		icon: Globe,
		title: "Multi-region redundancy",
		description:
			"Route across providers spread across US, EU, and APAC so a regional outage never takes you down.",
		accent: "text-purple-500 bg-purple-500/10",
	},
	{
		icon: Shield,
		title: "Rate-limit aware",
		description:
			"When a provider throttles you, traffic shifts automatically — you keep serving requests without manual intervention.",
		accent: "text-amber-500 bg-amber-500/10",
	},
	{
		icon: LineChart,
		title: "Observable by default",
		description:
			"Uptime, error rates, and latency tracked per provider in your dashboard. Use it in audits or share with stakeholders.",
		accent: "text-cyan-500 bg-cyan-500/10",
	},
	{
		icon: BarChart3,
		title: "SLA reporting",
		description:
			"Export uptime and performance reports for compliance. Enterprise plans include 99.9% SLAs with credits.",
		accent: "text-pink-500 bg-pink-500/10",
	},
];

export function ReliabilityFeatures() {
	return (
		<section className="py-20 sm:py-28">
			<div className="container mx-auto px-4 sm:px-6 lg:px-8">
				<div className="mx-auto max-w-6xl">
					<div className="mb-12 text-center sm:mb-16">
						<div className="mb-4 inline-flex items-center gap-2 rounded-full border border-border bg-muted px-4 py-1.5">
							<span className="text-xs font-mono text-blue-500">
								WHAT&apos;S INCLUDED
							</span>
						</div>
						<h2 className="mb-4 text-3xl font-bold tracking-tight text-balance sm:text-4xl lg:text-5xl">
							Built for production traffic.
						</h2>
						<p className="mx-auto max-w-3xl text-lg leading-relaxed text-muted-foreground text-balance">
							Reliability is the default — not an add-on. Every account gets the
							full routing engine.
						</p>
					</div>

					<div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
						{features.map((feature) => (
							<div
								key={feature.title}
								className="rounded-xl border border-border bg-card p-6 transition-colors hover:border-primary/50"
							>
								<div
									className={`mb-4 flex h-10 w-10 items-center justify-center rounded-lg ${feature.accent}`}
								>
									<feature.icon className="h-5 w-5" />
								</div>
								<h3 className="mb-2 text-lg font-semibold">{feature.title}</h3>
								<p className="text-sm leading-relaxed text-muted-foreground">
									{feature.description}
								</p>
							</div>
						))}
					</div>
				</div>
			</div>
		</section>
	);
}
