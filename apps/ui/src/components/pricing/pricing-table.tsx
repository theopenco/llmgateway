"use client";

import { Check, Minus } from "lucide-react";
import Link from "next/link";

import { AuthLink } from "@/components/shared/auth-link";
import { Button } from "@/lib/components/button";
import { cn } from "@/lib/utils";

import {
	MARKETING_STATS,
	PRO_PLAN_MAX_SEATS,
	PRO_PLAN_PRICES,
} from "@llmgateway/shared";

type FeatureValue = boolean | string;

interface PricingFeature {
	name: string;
	description?: string;
	learnMoreLink?: string;
	learnMoreText?: string;
	free: FeatureValue;
	pro: FeatureValue;
	enterprise: FeatureValue;
}

// Pro has the exact same product features as Free — it raises the seat and
// API-key limits and unlocks the SSO & SCIM add-on. Keep the Pro column
// identical to Free everywhere except limits, add-ons, and enterprise rows.
const pricingFeatures: PricingFeature[] = [
	{
		name: "Platform Fees",
		free: "5% on credit usage",
		pro: "5% on credit usage",
		enterprise: "Volume discounts",
	},
	{
		name: "Team Seats",
		description: "Members across your organization",
		free: "5 seats",
		pro: `Up to ${PRO_PLAN_MAX_SEATS} at $${PRO_PLAN_PRICES.seat}/user/mo`,
		enterprise: "Custom",
	},
	{
		name: "API Keys",
		description: "Active API keys across your organization",
		free: "5 keys",
		pro: `1 per seat, +$${PRO_PLAN_PRICES.extraApiKey}/mo per extra key`,
		enterprise: "Custom",
	},
	{
		name: "SSO/SAML & SCIM",
		description: "SAML 2.0 & OIDC with SCIM provisioning",
		learnMoreLink: "/enterprise/sso-saml",
		learnMoreText: "Learn more →",
		free: false,
		pro: `$${PRO_PLAN_PRICES.sso}/mo add-on`,
		enterprise: true,
	},
	{
		name: "Models",
		description: "200+ unique models across 40+ providers",
		learnMoreLink: "/models",
		learnMoreText: "Browse all models →",
		free: "All 200+ models",
		pro: "All 200+ models",
		enterprise: "All 200+ models",
	},
	{
		name: "Provider Choice",
		description: "Same model, multiple provider options",
		learnMoreLink: "/providers",
		learnMoreText: "View all providers →",
		free: "Full control + BYOK",
		pro: "Full control + BYOK",
		enterprise: "Custom routing rules",
	},
	{
		name: "Free Models",
		description: "Zero-cost models with rate limits",
		free: "3 (rate limited)",
		pro: "3 (rate limited)",
		enterprise: "3 (custom limits)",
	},
	{
		name: "Chat and API Access",
		description: "Access via API and Lounge",
		learnMoreLink: "/guides",
		learnMoreText: "View integration guides →",
		free: true,
		pro: true,
		enterprise: true,
	},
	{
		name: "Activity Logs & Export",
		free: true,
		pro: true,
		enterprise: true,
	},
	{
		name: "Data Retention",
		description: `Metadata is free; full payloads are ${MARKETING_STATS.dataStoragePrice}`,
		learnMoreLink:
			"https://docs.llmgateway.io/features/data-retention#storage-pricing",
		learnMoreText: "See storage pricing →",
		free: "30 days",
		pro: "30 days",
		enterprise: "Unlimited",
	},
	{
		name: "Auto-routing & Vendor Selection",
		description: "Automatic provider routing",
		learnMoreLink: "/features/auto-routing",
		free: true,
		pro: true,
		enterprise: true,
	},
	{
		name: "Budgets & Spend Controls",
		free: true,
		pro: true,
		enterprise: true,
	},
	{
		name: "Prompt Caching",
		description: "Cache prompts for faster responses",
		free: true,
		pro: true,
		enterprise: true,
	},
	{
		name: "Bring Your Own Keys (BYOK)",
		description: "Use your own provider API keys",
		free: "Included",
		pro: "Included",
		enterprise: "Custom limits",
	},
	{
		name: "Team Management",
		free: true,
		pro: true,
		enterprise: true,
	},
	{
		name: "Advanced Analytics",
		free: true,
		pro: true,
		enterprise: true,
	},
	{
		name: "Admin Controls",
		description: "Enterprise-level admin features",
		free: false,
		pro: false,
		enterprise: true,
	},
	{
		name: "Enterprise Audit Logs",
		description: "Immutable, SIEM-ready audit trails",
		learnMoreLink: "/enterprise/audit-logs",
		learnMoreText: "Learn more →",
		free: false,
		pro: false,
		enterprise: true,
	},
	{
		name: "Enterprise Guardrails",
		description: "Prompt injection, PII & secret detection",
		learnMoreLink: "/enterprise/guardrails",
		learnMoreText: "Learn more →",
		free: false,
		pro: false,
		enterprise: true,
	},
	{
		name: "Per-Project Routing Overrides",
		description: "Region pinning, fallback & cost ceilings per project",
		learnMoreLink: "/enterprise/routing-overrides",
		learnMoreText: "Learn more →",
		free: false,
		pro: false,
		enterprise: true,
	},
	{
		name: "Provider Compliance Policies",
		description: "Route only to SOC 2 / ISO 27001 / GDPR providers",
		learnMoreLink: "/enterprise/compliance",
		learnMoreText: "Learn more →",
		free: false,
		pro: false,
		enterprise: true,
	},
	{
		name: "Discord & Slack Alerts",
		description: "Real-time webhook alerts to your channels",
		learnMoreLink: "/enterprise/discord-notifications",
		learnMoreText: "Learn more →",
		free: false,
		pro: false,
		enterprise: true,
	},
	{
		name: "Contractual SLAs",
		free: false,
		pro: false,
		enterprise: true,
	},
	{
		name: "Chat App (Whitelabel)",
		description: "Ship the chat app under your own brand & domain",
		learnMoreLink: "/enterprise/white-label",
		learnMoreText: "Learn more →",
		free: false,
		pro: false,
		enterprise: true,
	},
	{
		name: "Payment Options",
		free: "Credit card",
		pro: "Credit card",
		enterprise: "Invoicing options",
	},
	{
		name: "Rate Limits",
		description: "Paid models are not rate limited",
		free: "20 reqs/min on free models",
		pro: "20 reqs/min on free models",
		enterprise: "Custom limits",
	},
	{
		name: "Token Pricing",
		description: "Model pricing details. Non-US cards: +1.5% intl fee",
		learnMoreLink: "/models",
		learnMoreText: "See model prices →",
		free: "Pay per token + 5% fee",
		pro: "Pay per token + 5% fee",
		enterprise: "Volume discounts",
	},
	{
		name: "Support",
		free: "Discord Community",
		pro: "Discord Community",
		enterprise: "24/7 SLA + Slack channel",
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
				<h2 className="text-2xl md:text-3xl font-bold tracking-tight text-center mb-8">
					Compare plans
				</h2>
				<div className="overflow-x-auto">
					<table className="w-full border-collapse min-w-[760px]">
						{/* Header */}
						<thead>
							<tr>
								<th scope="col" className="text-left p-4 w-1/4">
									<span className="sr-only">Feature</span>
								</th>
								<th scope="col" className="p-4 text-center w-1/4">
									<div className="font-semibold text-lg">Free</div>
									<div className="text-2xl font-bold mt-1">$0</div>
									<div className="text-sm text-muted-foreground">forever</div>
								</th>
								<th
									scope="col"
									className="p-4 text-center w-1/4 bg-blue-600/10 rounded-t-xl border-x border-t border-blue-600/20"
								>
									<div className="font-semibold text-lg text-blue-600 dark:text-blue-400">
										Pro
									</div>
									<div className="text-2xl font-bold mt-1">
										${PRO_PLAN_PRICES.seat}
									</div>
									<div className="text-sm text-muted-foreground">
										per user/month
									</div>
									<div className="mt-1 text-xs font-medium text-blue-600 dark:text-blue-400">
										Up to {PRO_PLAN_MAX_SEATS} users
									</div>
								</th>
								<th scope="col" className="p-4 text-center w-1/4">
									<div className="font-semibold text-lg">Enterprise</div>
									<div className="text-2xl font-bold mt-1">Custom</div>
									<div className="text-sm text-muted-foreground">
										Contact us
									</div>
									<div className="mt-1 text-xs font-medium text-blue-600 dark:text-blue-400">
										30-day trial
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
									<th scope="row" className="p-4 text-left font-normal">
										<div className="font-medium">{feature.name}</div>
										{feature.description && (
											<div className="text-sm text-muted-foreground">
												{feature.description}
											</div>
										)}
										{feature.learnMoreLink && (
											<Link
												href={feature.learnMoreLink as any}
												className="text-xs text-blue-700 underline underline-offset-2 dark:text-blue-400"
											>
												{feature.learnMoreText ?? feature.name}
											</Link>
										)}
									</th>
									<td className="p-4 text-center">
										<FeatureCell value={feature.free} />
									</td>
									<td className="p-4 text-center bg-blue-600/5 border-x border-blue-600/20">
										<FeatureCell value={feature.pro} />
									</td>
									<td className="p-4 text-center">
										<FeatureCell value={feature.enterprise} />
									</td>
								</tr>
							))}
							{/* CTA Row */}
							<tr>
								<th scope="row" className="p-4 text-left font-normal">
									<span className="sr-only">Get started</span>
								</th>
								<td className="p-6 text-center">
									<AuthLink href="/signup">
										<Button variant="outline" className="w-full max-w-[200px]">
											Get Started Free
										</Button>
									</AuthLink>
								</td>
								<td className="p-6 text-center bg-blue-600/5 border-x border-b border-blue-600/20 rounded-b-xl">
									<AuthLink href="/signup">
										<Button className="w-full max-w-[200px]">
											Upgrade to Pro
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
						support. Pro upgrades are managed from your organization&apos;s
						billing page.
						<br />
						Need volume discounts or a custom solution?{" "}
						<Link
							href="/enterprise"
							className="text-blue-700 underline underline-offset-2 dark:text-blue-400"
						>
							Contact our team
						</Link>
						.
					</p>
				</div>
			</div>
		</section>
	);
}
