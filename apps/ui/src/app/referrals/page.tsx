import {
	ArrowRight,
	ArrowUpRight,
	Check,
	Code2,
	DollarSign,
	Globe,
	Image,
	KeyRound,
	Minus,
	Network,
	RefreshCw,
	Shield,
	Zap,
} from "lucide-react";
import Link from "next/link";

import Footer from "@/components/landing/footer";
import { HeroRSC } from "@/components/landing/hero-rsc";
import { AuthLink } from "@/components/shared/auth-link";
import { Button } from "@/lib/components/button";

import type { Metadata, Route } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
	title: "Referral Program — Earn 1% of Referred LLM Spend",
	description:
		"Earn credits by referring new users to LLM Gateway. Get 1% of all LLM spending from users you refer, added directly to your account balance.",
	openGraph: {
		title: "Referral Program — Earn 1% of Referred LLM Spend",
		description:
			"Earn 1% of all LLM spending from users you refer to LLM Gateway.",
		type: "website",
	},
	twitter: {
		card: "summary_large_image",
		title: "Referral Program — Earn 1% of Referred LLM Spend",
		description:
			"Earn 1% of all LLM spending from users you refer to LLM Gateway.",
	},
};

const REFERRALS_SETTINGS_PATH = "/dashboard/referrals" as Route;
const SIGNUP_TO_REFERRALS_PATH =
	`/signup?redirect=${encodeURIComponent("/dashboard/referrals")}` as Route;

const ledgerRows = [
	{ team: "Northwind Labs", spend: 18_420 },
	{ team: "Atlas Robotics", spend: 9_860 },
	{ team: "Juniper Health", spend: 6_215 },
	{ team: "Fieldnote AI", spend: 3_480 },
];

const ledgerTotal = ledgerRows.reduce((sum, row) => sum + row.spend, 0);

const usd = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
});

const steps = [
	{
		title: "Unlock your link",
		description:
			"Top up $100 in credits once. Your unique referral link appears in the dashboard under Referrals.",
	},
	{
		title: "Share it anywhere",
		description:
			"Send it to teams who ship with LLMs. Pair it with any page below to make the case for you.",
	},
	{
		title: "Earn on every request",
		description:
			"1% of their LLM spend lands in your balance automatically. No claims, no payout thresholds.",
	},
];

const sellingPoints = [
	{
		icon: Network,
		title: "200+ models, one API",
		description:
			"OpenAI, Anthropic, Google, Meta, Mistral and 40+ providers behind one OpenAI-compatible endpoint.",
		href: "/features/unified-api-interface",
	},
	{
		icon: RefreshCw,
		title: "Automatic failover",
		description:
			"When a provider goes down or rate-limits, traffic reroutes to the next best one. Users never notice.",
		href: "/features/multi-provider-support",
	},
	{
		icon: Image,
		title: "Nano Banana savings",
		description:
			"Up to 20% off Gemini 3 Pro image generation. The simulator shows the savings at any volume.",
		href: "/nano-banana-simulator",
	},
	{
		icon: DollarSign,
		title: "5% platform fee",
		description:
			"Lower than OpenRouter's 5.5%. Bring your own keys and the platform fee drops to zero.",
		href: "/pricing",
	},
	{
		icon: Code2,
		title: "Dev plans for AI coding",
		description:
			"Fixed-price plans from $29/mo for Claude Code, Cursor, and Windsurf. Get 2× your subscription in monthly usage with all models included.",
		href: "/code",
		external: true,
	},
	{
		icon: Shield,
		title: "Guardrails built in",
		description:
			"Prompt injection protection, PII detection, secrets scanning and custom content rules.",
		href: "/features/guardrails",
	},
	{
		icon: Zap,
		title: "Response caching",
		description:
			"Cache repeated queries to cut cost and latency. Toggle it per project from the dashboard.",
		href: "/features/performance-monitoring",
	},
	{
		icon: Globe,
		title: "Self-host for free",
		description:
			"Open source under AGPLv3. Run it on your own infrastructure or use the managed cloud.",
		href: "/features/self-hosted-or-cloud",
	},
	{
		icon: KeyRound,
		title: "Bring your own keys",
		description:
			"Use existing provider keys with zero platform fee and keep analytics, failover and guardrails.",
		href: "/pricing",
	},
];

const migrationProviders = [
	{ name: "OpenRouter", slug: "open-router" },
	{ name: "Vercel AI Gateway", slug: "vercel-ai-gateway" },
	{ name: "LiteLLM", slug: "litellm" },
];

const devPlans = [
	{ name: "Lite", price: "$29" },
	{ name: "Pro", price: "$79", popular: true },
	{ name: "Max", price: "$179" },
];

const comparisonRows = [
	{ feature: "Platform fee", us: "5%", them: "5.5%" },
	{ feature: "BYOK fee", us: "Free", them: "1M free reqs/mo, then 5%" },
	{ feature: "Auto failover", us: "Built-in", them: "Yes" },
	{ feature: "Analytics", us: "Request-level insights", them: "Logs + export" },
	{ feature: "Self-hosting", us: "Free (AGPLv3)", them: null },
	{ feature: "Guardrails", us: "PII, injection, secrets", them: "Enterprise" },
	{ feature: "Dev plans (coding)", us: "From $29/mo", them: null },
	{ feature: "Image gen discounts", us: "Up to 20% off", them: null },
];

const programDetails = [
	{
		title: "Post-discount earnings",
		description:
			"Commission is calculated on LLM usage after any discounts are applied.",
	},
	{
		title: "Direct credit deposits",
		description:
			"Credits are added to your balance automatically. Nothing to claim.",
	},
	{
		title: "Use on any model",
		description:
			"Referral credits work with every model and provider. They cannot be withdrawn.",
	},
	{
		title: "No cap",
		description: "Refer as many teams as you like. Earnings never top out.",
	},
];

function SectionLabel({
	index,
	children,
}: {
	index: string;
	children: ReactNode;
}) {
	return (
		<p className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
			<span className="text-foreground">{index}</span>
			<span aria-hidden className="h-px w-8 bg-border" />
			{children}
		</p>
	);
}

function ReferralCta({ className }: { className?: string }) {
	return (
		<Button
			size="lg"
			className={`group h-12 px-7 text-base font-medium ${className ?? ""}`}
			asChild
		>
			<AuthLink
				href={REFERRALS_SETTINGS_PATH}
				authenticatedHref={REFERRALS_SETTINGS_PATH}
				unauthenticatedHref={SIGNUP_TO_REFERRALS_PATH}
			>
				Get my referral link
				<ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
			</AuthLink>
		</Button>
	);
}

function EarningsLedger() {
	return (
		<div className="relative">
			<div
				aria-hidden
				className="absolute -inset-px translate-x-3 translate-y-3 rounded-2xl border border-dashed border-foreground/20"
			/>
			<div className="relative overflow-hidden rounded-2xl border bg-background shadow-xl shadow-black/5 dark:shadow-black/40">
				<div className="flex items-center justify-between border-b px-5 py-3">
					<p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
						Referral ledger
					</p>
					<span className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
						<span className="relative flex h-1.5 w-1.5">
							<span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-foreground/60 motion-reduce:animate-none" />
							<span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-foreground" />
						</span>
						This month
					</span>
				</div>
				<div className="overflow-x-auto">
					<table className="w-full min-w-[300px] text-sm">
						<thead>
							<tr className="border-b font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
								<th className="px-3 py-2.5 sm:px-5 text-left font-normal">
									Team
								</th>
								<th className="px-3 py-2.5 sm:px-5 text-right font-normal">
									LLM spend
								</th>
								<th className="px-3 py-2.5 sm:px-5 text-right font-normal">
									You earn
								</th>
							</tr>
						</thead>
						<tbody>
							{ledgerRows.map((row) => (
								<tr
									key={row.team}
									className="border-b border-dashed last:border-0"
								>
									<td className="px-3 py-3 sm:px-5 font-medium">{row.team}</td>
									<td className="px-3 py-3 sm:px-5 text-right tabular-nums text-muted-foreground">
										{usd.format(row.spend)}
									</td>
									<td className="px-3 py-3 sm:px-5 text-right font-mono tabular-nums">
										+{usd.format(row.spend / 100)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
				<div className="flex items-end justify-between bg-foreground px-5 py-4 text-background">
					<div>
						<p className="font-mono text-[10px] uppercase tracking-[0.16em] opacity-60">
							Credited to your balance
						</p>
						<p className="font-display text-3xl font-bold tracking-tight tabular-nums">
							{usd.format(ledgerTotal / 100)}
						</p>
					</div>
					<p className="font-mono text-[10px] uppercase tracking-[0.16em] opacity-60">
						Example
					</p>
				</div>
			</div>
		</div>
	);
}

export default function ReferralsPublicPage() {
	return (
		<div className="min-h-screen bg-background text-foreground">
			<HeroRSC />

			<section className="relative overflow-hidden border-b">
				<div
					aria-hidden
					className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] bg-size-[56px_56px] opacity-40 mask-[radial-gradient(ellipse_70%_60%_at_30%_40%,black,transparent)]"
				/>
				<div className="container relative mx-auto px-4 pb-16 pt-40 md:pb-24 md:pt-44">
					<div className="mx-auto grid max-w-6xl items-center gap-14 lg:grid-cols-[1.1fr_1fr] lg:gap-16">
						<div className="animate-hero-enter space-y-8">
							<SectionLabel index="01">Referral program</SectionLabel>
							<h1 className="font-display text-balance text-5xl font-bold leading-[1.02] tracking-tight sm:text-6xl lg:text-7xl">
								Share the gateway.
								<br />
								<span className="text-muted-foreground">Earn 1% forever.</span>
							</h1>
							<p className="max-w-xl text-pretty text-base text-muted-foreground sm:text-lg">
								Every team you bring to LLM Gateway earns you{" "}
								<span className="font-medium text-foreground">
									1% of their LLM spend
								</span>{" "}
								as credits, for as long as they use it.
							</p>
							<div className="flex flex-col gap-3 sm:flex-row">
								<ReferralCta />
								<Button
									variant="outline"
									size="lg"
									className="h-12 px-7 text-base font-medium"
									asChild
								>
									<Link href="#how-it-works">How it works</Link>
								</Button>
							</div>
							<dl className="grid max-w-xl grid-cols-3 gap-px overflow-hidden rounded-xl border bg-border">
								{[
									{ value: "1%", label: "of referred spend" },
									{ value: "∞", label: "referrals" },
									{ value: "0", label: "claims to file" },
								].map((stat) => (
									<div
										key={stat.label}
										className="flex flex-col-reverse bg-background px-4 py-3"
									>
										<dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
											{stat.label}
										</dt>
										<dd className="font-display text-2xl font-bold tracking-tight">
											{stat.value}
										</dd>
									</div>
								))}
							</dl>
						</div>
						<div className="animate-hero-enter hero-enter-delay-1">
							<EarningsLedger />
						</div>
					</div>
				</div>
			</section>

			<section id="how-it-works" className="scroll-mt-20 border-b">
				<div className="container mx-auto px-4 py-16 md:py-24">
					<div className="mx-auto max-w-6xl space-y-12">
						<div className="grid gap-6 md:grid-cols-2 md:items-end">
							<div className="space-y-4">
								<SectionLabel index="02">How it works</SectionLabel>
								<h2 className="font-display text-balance text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl">
									Three steps, then it runs itself
								</h2>
							</div>
							<p className="text-pretty text-muted-foreground md:text-right">
								Eligibility unlocks after a one-time $100 top-up.
							</p>
						</div>
						<ol className="grid gap-px overflow-hidden rounded-2xl border bg-border md:grid-cols-3">
							{steps.map((step, i) => (
								<li
									key={step.title}
									className="group relative flex flex-col gap-10 bg-background p-8 transition-colors hover:bg-muted/40"
								>
									<span className="font-display text-6xl font-bold leading-none tracking-tighter text-foreground/15 transition-colors group-hover:text-foreground">
										{String(i + 1).padStart(2, "0")}
									</span>
									<div className="space-y-2">
										<h3 className="text-lg font-semibold tracking-tight">
											{step.title}
										</h3>
										<p className="text-sm leading-relaxed text-muted-foreground">
											{step.description}
										</p>
									</div>
								</li>
							))}
						</ol>
					</div>
				</div>
			</section>

			<section id="why-switch" className="scroll-mt-20 border-b">
				<div className="container mx-auto px-4 py-16 md:py-24">
					<div className="mx-auto max-w-6xl space-y-12">
						<div className="grid gap-6 md:grid-cols-2 md:items-end">
							<div className="space-y-4">
								<SectionLabel index="03">Why teams switch</SectionLabel>
								<h2 className="font-display text-balance text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl">
									Everything you need to make the case
								</h2>
							</div>
							<p className="text-pretty text-muted-foreground md:text-right">
								Each one links to a page you can share with your referral link.
							</p>
						</div>
						<div className="grid gap-px overflow-hidden rounded-2xl border bg-border sm:grid-cols-2 lg:grid-cols-3">
							{sellingPoints.map((point) => {
								const Icon = point.icon;
								const content = (
									<>
										<div className="flex items-start justify-between">
											<span className="flex h-10 w-10 items-center justify-center rounded-lg border bg-background transition-colors group-hover:bg-foreground group-hover:text-background">
												<Icon className="h-4.5 w-4.5" />
											</span>
											<ArrowUpRight className="h-4 w-4 text-muted-foreground transition-all group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-foreground" />
										</div>
										<div className="space-y-2">
											<h3 className="font-semibold tracking-tight">
												{point.title}
											</h3>
											<p className="text-sm leading-relaxed text-muted-foreground">
												{point.description}
											</p>
										</div>
									</>
								);
								const className =
									"group flex h-full flex-col gap-8 bg-background p-6 transition-colors hover:bg-muted/40";

								if (point.external) {
									return (
										<a
											key={point.title}
											href={point.href}
											target="_blank"
											rel="noopener noreferrer"
											className={className}
										>
											{content}
										</a>
									);
								}

								return (
									<Link
										key={point.title}
										href={point.href as Route}
										className={className}
										prefetch={true}
									>
										{content}
									</Link>
								);
							})}
						</div>
					</div>
				</div>
			</section>

			<section className="border-b">
				<div className="container mx-auto px-4 py-16 md:py-24">
					<div className="mx-auto max-w-6xl space-y-12">
						<div className="space-y-4">
							<SectionLabel index="04">Share kit</SectionLabel>
							<h2 className="font-display text-balance text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl">
								Proof that closes the deal
							</h2>
						</div>
						<div className="grid gap-4 lg:grid-cols-3">
							<div className="flex flex-col rounded-2xl border bg-foreground p-8 text-background">
								<p className="font-mono text-[10px] uppercase tracking-[0.16em] opacity-60">
									Savings at $10k/mo on Gemini 3 Pro images
								</p>
								<div className="mt-8 space-y-3">
									<div className="flex items-baseline justify-between border-b border-background/15 pb-3">
										<span className="text-sm opacity-70">Google direct</span>
										<span className="font-display text-xl font-bold tabular-nums line-through decoration-1 opacity-60">
											$10,000
										</span>
									</div>
									<div className="flex items-baseline justify-between">
										<span className="text-sm opacity-70">LLM Gateway</span>
										<span className="font-display text-xl font-bold tabular-nums">
											$8,000
										</span>
									</div>
								</div>
								<p className="mt-8 font-display text-4xl font-bold tracking-tight">
									$24,000
									<span className="ml-2 text-base font-normal opacity-60">
										saved / year
									</span>
								</p>
								<Link
									href="/nano-banana-simulator"
									prefetch={true}
									className="group mt-auto inline-flex items-center gap-2 pt-8 text-sm font-medium"
								>
									Open the simulator
									<ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
								</Link>
							</div>

							<div className="flex flex-col rounded-2xl border p-8">
								<p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
									Migration guides
								</p>
								<p className="mt-4 text-sm leading-relaxed text-muted-foreground">
									Step-by-step switches with minimal code changes. The API is
									OpenAI-compatible.
								</p>
								<ul className="mt-6 divide-y border-y">
									{migrationProviders.map((provider) => (
										<li key={provider.slug}>
											<Link
												href={`/migration/${provider.slug}` as Route}
												prefetch={true}
												className="group flex items-center justify-between py-3 text-sm font-medium"
											>
												From {provider.name}
												<ArrowRight className="h-3.5 w-3.5 text-muted-foreground transition-all group-hover:translate-x-0.5 group-hover:text-foreground" />
											</Link>
										</li>
									))}
								</ul>
								<Link
									href="/migration"
									prefetch={true}
									className="group mt-auto inline-flex items-center gap-2 pt-8 text-sm font-medium"
								>
									View all guides
									<ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
								</Link>
							</div>

							<div className="flex flex-col rounded-2xl border p-8">
								<p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
									Dev plans for AI coding
								</p>
								<p className="mt-4 text-sm leading-relaxed text-muted-foreground">
									Fixed-price plans for Claude Code, Cursor, Windsurf and any
									OpenAI-compatible tool.
								</p>
								<ul className="mt-6 divide-y border-y">
									{devPlans.map((plan) => (
										<li
											key={plan.name}
											className="flex items-center justify-between py-3 text-sm"
										>
											<span className="flex items-center gap-2 font-medium">
												{plan.name}
												{plan.popular ? (
													<span className="rounded-full bg-foreground px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-background">
														Popular
													</span>
												) : null}
											</span>
											<span className="tabular-nums text-muted-foreground">
												{plan.price}/mo
											</span>
										</li>
									))}
								</ul>
								<a
									href="/code"
									target="_blank"
									rel="noopener noreferrer"
									className="group mt-auto inline-flex items-center gap-2 pt-8 text-sm font-medium"
								>
									Explore dev plans
									<ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
								</a>
							</div>
						</div>
					</div>
				</div>
			</section>

			<section className="border-b">
				<div className="container mx-auto px-4 py-16 md:py-24">
					<div className="mx-auto max-w-6xl space-y-12">
						<div className="grid gap-6 md:grid-cols-2 md:items-end">
							<div className="space-y-4">
								<SectionLabel index="05">Competitive edge</SectionLabel>
								<h2 className="font-display text-balance text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl">
									How we compare
								</h2>
							</div>
							<div className="md:text-right">
								<Link
									href="/compare/open-router"
									prefetch={true}
									className="group inline-flex items-center gap-2 text-sm font-medium"
								>
									See the full comparison
									<ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
								</Link>
							</div>
						</div>
						<div className="overflow-x-auto rounded-2xl border">
							<table className="w-full min-w-[560px] text-sm">
								<thead>
									<tr className="border-b font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
										<th className="px-6 py-4 text-left font-normal">Feature</th>
										<th className="bg-foreground px-6 py-4 text-left font-normal text-background">
											LLM Gateway
										</th>
										<th className="px-6 py-4 text-left font-normal">
											OpenRouter
										</th>
									</tr>
								</thead>
								<tbody>
									{comparisonRows.map((row) => (
										<tr key={row.feature} className="border-b last:border-0">
											<td className="px-6 py-3.5 text-muted-foreground">
												{row.feature}
											</td>
											<td className="bg-muted/50 px-6 py-3.5 font-medium">
												<span className="inline-flex items-center gap-2">
													<Check className="h-3.5 w-3.5" />
													{row.us}
												</span>
											</td>
											<td className="px-6 py-3.5 text-muted-foreground">
												{row.them ?? (
													<span className="inline-flex items-center gap-2">
														<Minus className="h-3.5 w-3.5" />
														Not available
													</span>
												)}
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					</div>
				</div>
			</section>

			<section className="border-b">
				<div className="container mx-auto px-4 py-16 md:py-24">
					<div className="mx-auto grid max-w-6xl gap-12 lg:grid-cols-[1fr_1.4fr]">
						<div className="space-y-4">
							<SectionLabel index="06">Program details</SectionLabel>
							<h2 className="font-display text-balance text-3xl font-bold tracking-tight sm:text-4xl">
								The fine print, kept short
							</h2>
							<p className="text-pretty text-muted-foreground">
								Top up $100 in credits to unlock. Your link lives in your
								organization dashboard under Referrals.
							</p>
						</div>
						<dl className="grid gap-px overflow-hidden rounded-2xl border bg-border sm:grid-cols-2">
							{programDetails.map((detail) => (
								<div key={detail.title} className="space-y-2 bg-background p-6">
									<dt className="flex items-center gap-2 font-semibold tracking-tight">
										<Check className="h-4 w-4" />
										{detail.title}
									</dt>
									<dd className="text-sm leading-relaxed text-muted-foreground">
										{detail.description}
									</dd>
								</div>
							))}
						</dl>
					</div>
				</div>
			</section>

			<section>
				<div className="container mx-auto px-4 py-16 md:py-24">
					<div className="relative mx-auto max-w-6xl overflow-hidden rounded-3xl bg-foreground px-8 py-14 text-background md:px-14 md:py-20">
						<span
							aria-hidden
							className="pointer-events-none absolute -bottom-16 -right-4 hidden select-none md:block font-display text-[16rem] font-bold leading-none tracking-tighter opacity-[0.07] md:text-[22rem]"
						>
							1%
						</span>
						<div className="relative max-w-2xl space-y-6">
							<h2 className="font-display text-balance text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl">
								Your link is one click away
							</h2>
							<p className="text-pretty opacity-70 md:text-lg">
								Open your referral settings, copy your link, and start earning
								on every team that switches.
							</p>
							<div className="flex flex-col gap-3 sm:flex-row">
								<ReferralCta className="bg-background text-foreground hover:bg-background/90" />
								<Button
									variant="outline"
									size="lg"
									className="h-12 border-background/25 bg-transparent px-7 text-base font-medium text-background shadow-none hover:bg-background/10 hover:text-background dark:border-background/25 dark:bg-transparent dark:hover:bg-background/10"
									asChild
								>
									<Link href="/pricing" prefetch={true}>
										View pricing
									</Link>
								</Button>
							</div>
						</div>
					</div>
				</div>
			</section>

			<Footer />
		</div>
	);
}
