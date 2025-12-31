import { ArrowRight, Eye, Lock, Shield, ShieldCheck } from "lucide-react";

const badges = [
	{
		title: "99.99% Uptime SLA",
		href: "/docs/sla",
	},
	{
		title: "SOC 2 Type 1",
		href: "/security",
	},
	{
		title: "GDPR Compliant",
		href: "/privacy",
	},
];

const features = [
	{
		icon: Shield,
		title: "Enterprise-Grade Security",
		description:
			"End-to-end encryption, secure API key management, and comprehensive audit logs for all operations.",
	},
	{
		icon: Lock,
		title: "Access Control",
		description:
			"Role-based access control (RBAC), SSO integration, and granular permissions for your team.",
	},
	{
		icon: Eye,
		title: "Full Observability",
		description:
			"Real-time monitoring, detailed request logs, and performance metrics across all your LLM operations.",
	},
];

export function SecurityEnterprise() {
	return (
		<section className="py-20 sm:py-28 border-t border-border">
			<div className="container mx-auto px-4 sm:px-6 lg:px-8">
				<div className="grid lg:grid-cols-3 gap-8 lg:gap-0 lg:divide-x divide-border">
					{/* Left column - Heading */}
					<div className="lg:pr-12">
						<h2 className="text-4xl sm:text-5xl font-bold tracking-tight">
							Security meets
							<br />
							speed.
						</h2>
					</div>

					{/* Middle and Right columns - Badges */}
					<div className="lg:col-span-2 lg:pl-12">
						<div className="grid sm:grid-cols-3 gap-6">
							{badges.map((badge) => (
								<a
									key={badge.title}
									href={badge.href}
									className="group flex items-center justify-between p-4 rounded-lg hover:bg-muted/50 transition-colors"
								>
									<div className="flex items-center gap-3">
										<ShieldCheck className="h-5 w-5 text-primary" />
										<span className="font-semibold">{badge.title}</span>
									</div>
									<ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
								</a>
							))}
						</div>
					</div>
				</div>

				{/* Feature cards */}
				<div className="mt-16 grid sm:grid-cols-3 gap-8 lg:gap-12">
					{features.map((feature) => (
						<div key={feature.title} className="space-y-4">
							<div className="flex items-center gap-3">
								<div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
									<feature.icon className="h-5 w-5 text-muted-foreground" />
								</div>
								<h3 className="font-semibold">{feature.title}</h3>
							</div>
							<p className="text-muted-foreground leading-relaxed">
								{feature.description}
							</p>
						</div>
					))}
				</div>
			</div>
		</section>
	);
}
