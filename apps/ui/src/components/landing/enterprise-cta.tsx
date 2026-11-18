import { ArrowRight, Building2, Lock, Server, Zap } from "lucide-react";
import Link from "next/link";

import { TrackedLink } from "@/components/home/tracked-link";
import { Button } from "@/lib/components/button";

import { AnimatedGroup } from "./animated-group";

const capabilities = [
	{
		icon: Lock,
		title: "Enterprise SSO",
		description:
			"SAML 2.0 single sign-on and SCIM provisioning with role-based access control",
		href: "/enterprise/sso-saml",
	},
	{
		icon: Server,
		title: "Self-hosted or Managed",
		description:
			"Deploy on your infrastructure or let us run it, with a 99.9% SLA on Enterprise Cloud",
		href: "/enterprise#pricing",
	},
	{
		icon: Zap,
		title: "Volume Pricing",
		description: "Custom rate limits and pricing that scales with your usage",
		href: "/enterprise#pricing",
	},
	{
		icon: Building2,
		title: "White-label Ready",
		description: "White-label gateway and chat app with your own branding",
		href: "/enterprise/white-label",
	},
] as const;

const controls = [
	{ label: "Audit logs", href: "/enterprise/audit-logs" },
	{ label: "Guardrails", href: "/enterprise/guardrails" },
	{ label: "Zero data retention", href: "/enterprise/zero-data-retention" },
	{ label: "Compliance policies", href: "/enterprise/compliance" },
	{ label: "Per-member budgets", href: "/enterprise/member-budgets" },
	{ label: "Data streams to your SIEM", href: "/enterprise/data-streams" },
] as const;

const pilotSteps = [
	{ phase: "Week 1", title: "Traffic live" },
	{ phase: "Week 2", title: "Controls on" },
	{ phase: "Day 30", title: "Decision gate" },
];

export function EnterpriseCTA() {
	return (
		<section className="relative py-24 md:py-32 overflow-hidden">
			<div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-border to-transparent" />
			<div className="absolute inset-0 bg-gradient-to-b from-foreground/[0.03] via-foreground/[0.05] to-foreground/[0.03]" />
			<div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,var(--color-blue-500)/0.08,transparent)]" />

			<div className="container relative mx-auto px-4">
				<div className="max-w-6xl mx-auto">
					<AnimatedGroup preset="blur-slide" className="text-center mb-12">
						<span className="mb-6 inline-flex items-center gap-2 rounded-full border border-blue-500/30 bg-blue-500/10 px-4 py-1.5 text-xs font-mono uppercase tracking-wider text-blue-500">
							<span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
							For teams · 30-Day Production Pilot
						</span>
						<h2 className="font-display text-3xl md:text-4xl lg:text-5xl font-bold tracking-tight text-foreground text-balance">
							LLMs in production in 30 days, with SSO, audit logs and guardrails
						</h2>
						<p className="mt-4 text-lg text-muted-foreground max-w-2xl mx-auto text-balance">
							Every enterprise plan starts with a pilot on live traffic. If we
							miss the milestones, you walk away. No long-term contract before
							day 30.
						</p>
					</AnimatedGroup>

					<AnimatedGroup
						preset="slide"
						className="mx-auto mb-10 grid max-w-3xl grid-cols-3 gap-3"
					>
						{pilotSteps.map((step) => (
							<div
								key={step.phase}
								className="rounded-xl border border-border/50 bg-background/80 px-4 py-4 text-center backdrop-blur-sm"
							>
								<span className="text-xs font-mono uppercase tracking-wider text-blue-500">
									{step.phase}
								</span>
								<p className="mt-1 text-sm font-semibold text-foreground sm:text-base">
									{step.title}
								</p>
							</div>
						))}
					</AnimatedGroup>

					<AnimatedGroup
						preset="blur-slide"
						className="flex flex-col sm:flex-row items-center justify-center gap-4"
					>
						<Button
							size="lg"
							className="bg-foreground text-background hover:bg-foreground/90 px-8 py-6 text-base font-medium w-full sm:w-auto"
							asChild
						>
							<TrackedLink
								href="/enterprise#contact"
								location="home_enterprise"
								cta="start_pilot"
							>
								Start a 30-Day Pilot
								<ArrowRight className="ml-2 h-4 w-4" />
							</TrackedLink>
						</Button>
						<Button
							size="lg"
							variant="outline"
							className="border-border bg-transparent text-foreground hover:bg-muted px-8 py-6 text-base w-full sm:w-auto"
							asChild
						>
							<TrackedLink
								href="/enterprise"
								location="home_enterprise"
								cta="explore_enterprise"
							>
								Explore Enterprise
							</TrackedLink>
						</Button>
					</AnimatedGroup>

					<AnimatedGroup
						preset="slide"
						className="mt-14 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
					>
						{capabilities.map((cap) => (
							<Link
								key={cap.title}
								href={cap.href}
								className="group block h-full rounded-xl border border-border/50 bg-background/80 backdrop-blur-sm p-6 transition-all duration-300 hover:border-blue-500/30 hover:shadow-md hover:shadow-blue-500/5"
							>
								<div className="w-10 h-10 rounded-lg border border-border bg-muted flex items-center justify-center mb-4 transition-colors group-hover:border-blue-500/30 group-hover:bg-blue-500/5">
									<cap.icon className="h-5 w-5 text-muted-foreground transition-colors group-hover:text-blue-500" />
								</div>
								<h3 className="text-base font-semibold tracking-tight text-foreground mb-1.5">
									{cap.title}
								</h3>
								<p className="text-sm leading-relaxed text-muted-foreground">
									{cap.description}
								</p>
							</Link>
						))}
					</AnimatedGroup>

					<AnimatedGroup
						preset="fade"
						className="mt-6 flex flex-wrap items-center justify-center gap-2"
					>
						{controls.map((control) => (
							<Link
								key={control.href}
								href={control.href}
								className="block rounded-full border border-border/60 bg-background/60 px-3.5 py-1.5 text-sm text-muted-foreground transition-colors hover:border-blue-500/40 hover:text-foreground"
							>
								{control.label}
							</Link>
						))}
					</AnimatedGroup>

					<AnimatedGroup
						preset="fade"
						className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-muted-foreground"
					>
						<span>SOC 2 Type II compliant</span>
						<span className="block h-3 w-px bg-border" />
						<span>Custom SLAs</span>
						<span className="block h-3 w-px bg-border" />
						<span>Priority support</span>
						<span className="h-3 w-px bg-border hidden sm:block" />
						<TrackedLink
							href="/savings-audit"
							location="home_enterprise"
							cta="savings_audit"
							className="hidden underline underline-offset-4 hover:text-foreground sm:inline"
						>
							Run a free savings audit
						</TrackedLink>
					</AnimatedGroup>
				</div>
			</div>
		</section>
	);
}
