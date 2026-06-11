import { ArrowRight, Eye, Lock, Shield, ShieldCheck } from "lucide-react";
import Link from "next/link";

const badges = [
	{
		title: "99.99% Uptime SLA",
		href: "https://status.llmgateway.io/",
		external: true,
	},
	{
		title: "SOC 2 Type II",
		href: "https://security.llmgateway.io/",
		external: true,
	},
	{
		title: "GDPR Compliant",
		href: "/legal/privacy",
		external: false,
	},
];

const features = [
	{
		icon: Shield,
		title: "SOC 2 Type II Certified",
		description:
			"Independently audited controls for security, availability, and confidentiality. Request our report at security.llmgateway.io.",
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
							{badges.map((badge) => {
								const content = (
									<>
										<div className="flex items-center gap-3">
											<ShieldCheck className="h-5 w-5 text-primary" />
											<span className="font-semibold">{badge.title}</span>
										</div>
										<ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
									</>
								);
								const className =
									"group flex items-center justify-between p-4 rounded-lg hover:bg-muted/50 transition-colors";
								return badge.external ? (
									<a
										key={badge.title}
										href={badge.href}
										target="_blank"
										rel="noopener noreferrer"
										className={className}
									>
										{content}
									</a>
								) : (
									<Link
										key={badge.title}
										href={badge.href}
										className={className}
									>
										{content}
									</Link>
								);
							})}
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
