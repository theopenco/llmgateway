"use client";

import { Check, Minus } from "lucide-react";
import Link from "next/link";

import { AuthLink } from "@/components/shared/auth-link";
import { Button } from "@/lib/components/button";
import { cn } from "@/lib/utils";

type FeatureValue = boolean | string;

interface PricingFeature {
	name: string;
	description?: string;
	learnMoreLink?: string;
	learnMoreText?: string;
	free: FeatureValue;
	enterprise: FeatureValue;
}

const pricingFeatures: PricingFeature[] = [
	{
		name: "Platform Fees",
		free: "5% on credit usage",
		enterprise: "Volume discounts",
	},
	{
		name: "Models",
		description: "180+ unique models across 60+ providers",
		learnMoreLink: "/models",
		learnMoreText: "Browse all models →",
		free: "450+ routing options",
		enterprise: "450+ routing options",
	},
	{
		name: "Provider Choice",
		description: "Same model, multiple provider options",
		learnMoreLink: "/providers",
		learnMoreText: "View all providers →",
		free: "Full control + BYOK",
		enterprise: "Custom routing rules",
	},
	{
		name: "Free Models",
		description: "Zero-cost models with rate limits",
		free: "25+ (rate limited)",
		enterprise: "25+ (custom limits)",
	},
	{
		name: "Chat and API Access",
		description: "Access via API and Playground",
		learnMoreLink: "/guides",
		learnMoreText: "View integration guides →",
		free: true,
		enterprise: true,
	},
	{
		name: "Activity Logs & Export",
		free: true,
		enterprise: true,
	},
	{
		name: "Data Retention",
		free: "30 days",
		enterprise: "Unlimited",
	},
	{
		name: "Auto-routing & Vendor Selection",
		description: "Automatic provider routing",
		learnMoreLink: "/features/auto-routing",
		free: true,
		enterprise: true,
	},
	{
		name: "Budgets & Spend Controls",
		free: true,
		enterprise: true,
	},
	{
		name: "Prompt Caching",
		description: "Cache prompts for faster responses",
		free: true,
		enterprise: true,
	},
	{
		name: "Bring Your Own Keys (BYOK)",
		description: "Use your own provider API keys",
		free: "Included",
		enterprise: "Custom limits",
	},
	{
		name: "Team Management",
		free: true,
		enterprise: true,
	},
	{
		name: "Advanced Analytics",
		free: true,
		enterprise: true,
	},
	{
		name: "Admin Controls",
		description: "Enterprise-level admin features",
		free: false,
		enterprise: true,
	},
	{
		name: "Data Policy-Based Routing",
		description: "Route based on data policies",
		free: false,
		enterprise: true,
	},
	{
		name: "Managed Policy Enforcement",
		free: false,
		enterprise: true,
	},
	{
		name: "SSO/SAML",
		free: false,
		enterprise: true,
	},
	{
		name: "Contractual SLAs",
		free: false,
		enterprise: true,
	},
	{
		name: "Chat App (Whitelabel)",
		free: false,
		enterprise: true,
	},
	{
		name: "Payment Options",
		free: "Credit card",
		enterprise: "Invoicing options",
	},
	{
		name: "Rate Limits",
		description: "Paid models are not rate limited",
		free: "20 reqs/min (free models)",
		enterprise: "Custom limits",
	},
	{
		name: "Token Pricing",
		description: "Model pricing details",
		learnMoreLink: "/models",
		learnMoreText: "See model prices →",
		free: "Pay per token + 5% fee",
		enterprise: "Volume discounts",
	},
	{
		name: "Support",
		free: "Discord Community",
		enterprise: "24/7 SLA + Discord channel",
	},
];

function FeatureCell({ value }: { value: FeatureValue }) {
	if (typeof value === "boolean") {
		return value ? (
			<Check className="size-5 text-green-500 mx-auto" />
		) : (
			<Minus className="size-5 text-muted-foreground/50 mx-auto" />
		);
	}
	return (
		<span className="text-sm text-center block text-muted-foreground">
			{value}
		</span>
	);
}

export function PricingTable() {
	return (
		<section className="w-full pb-16 md:pb-24">
			<div className="container mx-auto px-4 md:px-6">
				<div className="overflow-x-auto">
					<table className="w-full border-collapse min-w-[600px]">
						{/* Header */}
						<thead>
							<tr>
								<th className="text-left p-4 w-1/3" />
								<th className="p-4 text-center w-1/3 bg-blue-600/10 rounded-t-xl border-x border-t border-blue-600/20">
									<div className="font-semibold text-lg text-blue-600 dark:text-blue-400">
										Free
									</div>
									<div className="text-2xl font-bold mt-1">$0</div>
									<div className="text-sm text-muted-foreground">forever</div>
								</th>
								<th className="p-4 text-center w-1/3">
									<div className="font-semibold text-lg">Enterprise</div>
									<div className="text-2xl font-bold mt-1">Custom</div>
									<div className="text-sm text-muted-foreground">
										Contact us
									</div>
								</th>
							</tr>
						</thead>
						<tbody>
							{pricingFeatures.map((feature, index) => (
								<tr
									key={feature.name}
									className={cn(
										"border-b border-border/50",
										index % 2 === 0 ? "bg-muted/30" : "",
									)}
								>
									<td className="p-4">
										<div className="font-medium">{feature.name}</div>
										{feature.description && (
											<div className="text-sm text-muted-foreground">
												{feature.description}
											</div>
										)}
										{feature.learnMoreLink && (
											<Link
												href={feature.learnMoreLink as any}
												className="text-xs text-blue-600 hover:underline"
											>
												{feature.learnMoreText || feature.name}
											</Link>
										)}
									</td>
									<td className="p-4 text-center bg-blue-600/5 border-x border-blue-600/20">
										<FeatureCell value={feature.free} />
									</td>
									<td className="p-4 text-center">
										<FeatureCell value={feature.enterprise} />
									</td>
								</tr>
							))}
							{/* CTA Row */}
							<tr>
								<td className="p-4" />
								<td className="p-6 text-center bg-blue-600/5 border-x border-b border-blue-600/20 rounded-b-xl">
									<AuthLink href="/signup">
										<Button className="w-full max-w-[200px]">
											Get Started Free
										</Button>
									</AuthLink>
								</td>
								<td className="p-6 text-center">
									<Link href="/enterprise">
										<Button variant="outline" className="w-full max-w-[200px]">
											Contact Sales
										</Button>
									</Link>
								</td>
							</tr>
						</tbody>
					</table>
				</div>

				{/* Additional info */}
				<div className="mt-12 text-center">
					<p className="text-muted-foreground">
						All plans include access to our API, documentation, and community
						support.
						<br />
						Need a custom solution?{" "}
						<Link href="/enterprise" className="text-blue-600 hover:underline">
							Contact our team
						</Link>
						.
					</p>
				</div>
			</div>
		</section>
	);
}
