import {
	BarChart3,
	Database,
	Headphones,
	Key,
	MessageSquare,
	Rocket,
	Shield,
	Users,
	Wallet,
} from "lucide-react";

import { Card } from "@/lib/components/card";

const features = [
	{
		icon: Key,
		title: "Use Your Own API Keys",
		description:
			"Bring your own provider API keys without any surcharges. Full control over your costs.",
	},
	{
		icon: Wallet,
		title: "Lowest Fees on Credits",
		description:
			"Only 1% platform fee on credit purchases. Keep more of your budget for actual usage.",
	},
	{
		icon: BarChart3,
		title: "Advanced Analytics",
		description:
			"Deep insights into usage patterns, costs, and performance across all your LLM operations.",
	},
	{
		icon: Users,
		title: "Unlimited Seats",
		description:
			"Add as many team members as you need. No per-seat pricing or user limits.",
	},
	{
		icon: Rocket,
		title: "On-boarding Assistance",
		description:
			"Dedicated support during setup and migration. We ensure a smooth transition for your team.",
	},
	{
		icon: Database,
		title: "Unlimited Data Retention",
		description:
			"Keep your request logs and analytics data forever. No automatic deletion or storage limits.",
	},
	{
		icon: Headphones,
		title: "24/7 Premium Support",
		description:
			"Round-the-clock access to our engineering team. Priority response for any issues.",
	},
	{
		icon: MessageSquare,
		title: "Chat App & Whitelabel",
		description:
			"Full-featured chat playground included. Customize with your branding for internal or customer use.",
	},
	{
		icon: Shield,
		title: "Single Sign-On (SSO)",
		description:
			"Seamless integration with your identity provider. Support for SAML, OAuth, and OIDC.",
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
