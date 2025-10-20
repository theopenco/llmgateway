import { Check } from "lucide-react";
import Link from "next/link";

import { Button } from "@/lib/components/button";
import { Card } from "@/lib/components/card";

const plans = [
	{
		name: "Self-Hosted",
		description: "Deploy on your infrastructure with complete control",
		features: [
			"Enterprise SSO integration",
			"Provider configuration UI",
			"Terraform modules for AWS, GCP, bare metal",
			"White label gateway & chat playground",
			"Prioritized feature requests",
			"On-boarding assistance",
			"Dedicated support channel",
		],
		cta: "Get In Touch",
		highlighted: false,
	},
	{
		name: "Enterprise Cloud",
		description: "Fully managed with custom scaling and pricing",
		features: [
			"Everything in Self-Hosted",
			"Fully managed infrastructure",
			"Custom rate limits",
			"Volume-based pricing",
			"Advanced monitoring & analytics",
			"99.9% SLA guarantee",
			"Priority incident response",
		],
		cta: "Contact Us",
		highlighted: true,
	},
];

export function PricingEnterprise() {
	return (
		<section id="pricing" className="py-20 sm:py-28 bg-muted/30">
			<div className="container mx-auto px-4 sm:px-6 lg:px-8">
				<div className="mx-auto max-w-2xl text-center mb-16">
					<h2 className="mb-4 text-3xl font-bold tracking-tight sm:text-4xl lg:text-5xl text-balance">
						Enterprise pricing that scales with you
					</h2>
					<p className="text-lg text-muted-foreground text-balance leading-relaxed">
						Choose between self-hosted control or fully managed convenience.
						Both options include all enterprise features.
					</p>
				</div>
				<div className="mx-auto max-w-5xl grid gap-8 lg:grid-cols-2">
					{plans.map((plan) => (
						<Card
							key={plan.name}
							className={`p-8 ${
								plan.highlighted
									? "border-blue-500 bg-card shadow-lg shadow-blue-500/10"
									: "border-border bg-card"
							}`}
						>
							<div className="mb-6">
								<h3 className="mb-2 text-2xl font-bold">{plan.name}</h3>
								<p className="text-muted-foreground mb-4">{plan.description}</p>
							</div>
							<ul className="mb-8 space-y-3">
								{plan.features.map((feature) => (
									<li key={feature} className="flex items-start gap-3">
										<Check className="h-5 w-5 text-blue-500 shrink-0 mt-0.5" />
										<span className="text-sm leading-relaxed">{feature}</span>
									</li>
								))}
							</ul>
							<Button
								className="w-full"
								variant={plan.highlighted ? "default" : "outline"}
								size="lg"
								asChild
							>
								<Link href="/enterprise#contact">{plan.cta}</Link>
							</Button>
						</Card>
					))}
				</div>
				<p className="mt-8 text-center text-sm text-muted-foreground">
					Contact us for custom plans and enterprise agreements.
				</p>
			</div>
		</section>
	);
}
