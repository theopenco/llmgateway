"use client";

import { Check } from "lucide-react";
import { useRouter } from "next/navigation";

import { useUser } from "@/hooks/useUser";
import { Badge } from "@/lib/components/badge";
import { Button } from "@/lib/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";

export function PricingPlans() {
	const { user } = useUser();
	const router = useRouter();

	const handlePlanSelection = (planName: string) => {
		switch (planName) {
			case "Self-Host":
				router.push("https://docs.llmgateway.io");
				return;
			case "Enterprise":
				router.push("/enterprise");
				return;
		}

		if (!user) {
			router.push("/signup");
		} else {
			router.push("/dashboard");
		}
	};

	const plans = [
		{
			name: "Self-Host",
			description: "Host on your own infrastructure",
			price: "Free",
			features: [
				"100% free forever",
				"Full control over your data",
				"Host on your infrastructure",
				"No usage limits",
				"Community support",
				"Regular updates",
			],
			cta: "View Documentation",
			popular: false,
		},
		{
			name: "Free",
			description: "Full-featured plan for everyone",
			price: "$0",
			features: [
				"Access to ALL models",
				"Pay with credits (5% fee)",
				"Bring Your Own Keys (free)",
				"30-day data retention",
				"Team Management",
				"Advanced Analytics",
				"Auto-routing & Vendor Selection",
				"Discord support",
			],
			cta: user ? "Go to Dashboard" : "Get Started",
			popular: true,
		},
		{
			name: "Enterprise",
			description: "For large organizations with custom needs",
			price: "Custom",
			features: [
				"Everything in Free",
				"Unlimited seats",
				"Prioritized feature requests",
				"On-boarding assistance",
				"Unlimited data retention",
				"24/7 premium support",
				"Chat-App (incl. whitelabel)",
				"Single Sign-On (SSO)",
				"Volume discounts",
			],
			cta: "Contact Sales",
			popular: false,
		},
	];

	return (
		<section className="w-full py-12 md:py-24 bg-muted/30" id="pricing">
			<div className="container mx-auto px-4 md:px-6">
				<div className="text-center mb-12">
					<Badge variant="outline" className="mb-4">
						Pricing
					</Badge>
					<h2 className="text-3xl font-bold tracking-tighter sm:text-4xl md:text-5xl mb-4">
						Start for free, Scale with low fees
					</h2>
					<p className="text-xl text-muted-foreground max-w-3xl mx-auto">
						All features included in our free plan. No hidden fees or surprises.
					</p>
				</div>

				<div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto">
					{plans.map((plan, index) => (
						<Card
							key={index}
							className={`flex flex-col relative ${
								plan.popular ? "border-primary shadow-lg relative" : ""
							}`}
						>
							{plan.popular && (
								<div className="absolute top-0 right-0 transform translate-x-2 -translate-y-2">
									<Badge className="bg-primary hover:bg-primary">
										Recommended
									</Badge>
								</div>
							)}
							<CardHeader>
								<CardTitle>{plan.name}</CardTitle>
								<CardDescription>{plan.description}</CardDescription>
								<div className="mt-4">
									<span className="text-3xl font-bold">{plan.price}</span>
									{plan.price !== "Custom" && plan.price !== "Free" && (
										<span className="text-muted-foreground ml-1">forever</span>
									)}
								</div>
							</CardHeader>
							<CardContent className="flex-grow">
								<ul className="space-y-2">
									{plan.features.map((feature, i) => (
										<li key={i} className="flex items-center">
											<Check className="h-4 w-4 mr-2 text-green-500 flex-shrink-0" />
											<span className="text-sm">{feature}</span>
										</li>
									))}
								</ul>
							</CardContent>
							<CardFooter>
								<Button
									className={`w-full ${plan.popular ? "bg-primary hover:bg-primary/90" : ""}`}
									variant={plan.popular ? "default" : "outline"}
									onClick={() => handlePlanSelection(plan.name)}
								>
									{plan.cta}
								</Button>
							</CardFooter>
						</Card>
					))}
				</div>

				<div className="mt-12 text-center">
					<p className="text-muted-foreground">
						All plans include access to our API, documentation, and community
						support.
						<br />
						Need a custom solution?{" "}
						<a
							href="mailto:contact@llmgateway.io"
							className="text-primary hover:underline"
						>
							Contact our sales team
						</a>
						.
					</p>
				</div>
			</div>
		</section>
	);
}
