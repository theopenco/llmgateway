import {
	Shield,
	Settings,
	Cloud,
	Palette,
	Zap,
	Headphones,
} from "lucide-react";

import { Card } from "@/lib/components/card";

const features = [
	{
		icon: Shield,
		title: "Enterprise SSO",
		description:
			"Seamless integration with your existing identity provider. Support for SAML, OAuth, and OIDC protocols.",
	},
	{
		icon: Settings,
		title: "Provider Configuration UI",
		description:
			"Configure and manage your LLM providers through an intuitive interface. No code changes required.",
	},
	{
		icon: Cloud,
		title: "Infrastructure as Code",
		description:
			"Deploy to AWS, GCP, or bare metal with Terraform modules. Full control over your infrastructure.",
	},
	{
		icon: Palette,
		title: "White Label Solution",
		description:
			"Customize the gateway and chat playground with your branding. Make it truly yours.",
	},
	{
		icon: Zap,
		title: "Prioritized Features",
		description:
			"Your feature requests go to the front of the queue. Direct influence on product roadmap.",
	},
	{
		icon: Headphones,
		title: "Dedicated Support",
		description:
			"On-boarding assistance and ongoing support from our engineering team. We ensure your success.",
	},
];

export function FeaturesEnterprise() {
	return (
		<section id="features" className="py-20 sm:py-28">
			<div className="container mx-auto px-4 sm:px-6 lg:px-8">
				<div className="mx-auto max-w-2xl text-center mb-16">
					<h2 className="mb-4 text-3xl font-bold tracking-tight sm:text-4xl lg:text-5xl text-balance">
						Built for enterprise scale and security
					</h2>
					<p className="text-lg text-muted-foreground text-balance leading-relaxed">
						Everything you need to deploy and manage LLM infrastructure across
						your organization with confidence.
					</p>
				</div>
				<div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
					{features.map((feature) => (
						<Card
							key={feature.title}
							className="p-6 bg-card border-border hover:border-blue-500/50 transition-colors"
						>
							<div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-blue-500/10">
								<feature.icon className="h-6 w-6 text-blue-500" />
							</div>
							<h3 className="mb-2 text-xl font-semibold">{feature.title}</h3>
							<p className="text-muted-foreground leading-relaxed">
								{feature.description}
							</p>
						</Card>
					))}
				</div>
			</div>
		</section>
	);
}
