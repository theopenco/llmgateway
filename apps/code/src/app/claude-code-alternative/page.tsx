import { ArrowRight, DollarSign, Gauge, Layers } from "lucide-react";
import Link from "next/link";

import { BrandTile } from "@/components/brand-logos";
import { ComparisonTable } from "@/components/ComparisonTable";
import { DevPassPlanChangeNotice } from "@/components/DevPassPlanChangeNotice";
import { Footer } from "@/components/Footer";
import { GetDevPassButton } from "@/components/GetDevPassButton";
import { Header } from "@/components/Header";
import { CodeCTATracker } from "@/components/LandingTracker";
import { SwitchIn60 } from "@/components/SwitchIn60";
import { Button } from "@/components/ui/button";

import {
	DEV_PLAN_PRICES,
	getDevPlanCreditsLimit,
	MARKETING_STATS,
} from "@llmgateway/shared";

import type { Metadata } from "next";

const BASE_URL = "https://devpass.llmgateway.io";
const PAGE_PATH = "/claude-code-alternative";

const TITLE = "Claude Code Alternative (2026): Plans, Pricing, and Limits";
const DESCRIPTION = `DevPass keeps the Claude Code CLI and replaces the Max subscription: one key for the live coding catalog at provider rates, from $${DEV_PLAN_PRICES.lite}/mo. Monthly and premium weekly limits apply.`;

export const metadata: Metadata = {
	title: { absolute: `${TITLE} | DevPass` },
	description: DESCRIPTION,
	alternates: { canonical: PAGE_PATH },
	openGraph: {
		title: TITLE,
		description: DESCRIPTION,
		type: "article",
		url: `${BASE_URL}${PAGE_PATH}`,
	},
	twitter: {
		card: "summary_large_image",
		title: TITLE,
		description: DESCRIPTION,
	},
};

const FACTS_DATE = "September 27, 2026";

const painPoints = [
	{
		icon: Gauge,
		title: "Different usage limits",
		body: "Claude plans have five-hour and weekly limits, visible in Settings > Usage. Paid usage credits can keep work going after included limits. DevPass has its own monthly and premium weekly limits.",
	},
	{
		icon: DollarSign,
		title: "Different subscription prices",
		body: "Claude Pro includes Claude Code for $20/month. Max offers higher usage at $100 or $200/month. DevPass starts at $29/month; whether it saves money depends on the models and tokens you use.",
	},
	{
		icon: Layers,
		title: "Different model choices",
		body: "Claude subscriptions bundle the Claude experience. DevPass provides a shared allowance across its live coding catalog, for tools that support its compatible APIs and endpoints.",
	},
];

const comparisonFeatures = [
	{
		label: "Monthly price",
		devpass: "From $29 (Lite)",
		competitor: "$20 Pro; $100 / $200 Max",
	},
	{
		label: "Model access",
		devpass: "Live DevPass coding catalog",
		competitor: "Claude subscription catalog",
	},
	{
		label: "Usage visibility",
		devpass: "Per-request dollar costs",
		competitor: "Settings > Usage and usage-credit costs",
	},
	{
		label: "Included limits",
		devpass: "Monthly allowance + premium weekly limits",
		competitor: "Five-hour and weekly limits",
	},
	{
		label: "Paid overflow",
		devpass: "Optional PAYG credits",
		competitor: "Optional usage credits at API rates",
	},
	{ label: "Claude Code CLI", devpass: true, competitor: true },
	{
		label: "Other coding tools",
		devpass: "Compatible custom-endpoint clients",
		competitor: "Supported Claude subscription integrations",
	},
	{ label: "Claude web and mobile apps", devpass: false, competitor: true },
];

const faqs = [
	{
		question: "Can I keep Claude Code with DevPass?",
		answer:
			"Yes. Configure the documented DevPass endpoint and authentication variables in Claude Code, select a supported model, and test your workflow. Compatibility depends on the model and features used.",
	},
	{
		question: "Is DevPass cheaper than Claude?",
		answer:
			"Claude Pro starts at $20/month and includes Claude Code. Max is $100 or $200/month. DevPass starts at $29, with model usage metered in dollars. No fixed savings claim applies to every workload.",
	},
	{
		question: "Does DevPass have weekly limits?",
		answer:
			"Yes. DevPass has a monthly allowance and separate premium weekly fair-use limits. Optional PAYG overflow costs extra. Daily caps and tighter premium weekly limits start October 15, 2026; new subscriptions also begin at a lower monthly allowance from that date.",
	},
	{
		question: "Can Claude users continue after a limit?",
		answer:
			"Paid Claude plans can enable usage credits, billed separately at standard API rates, with configurable spend limits. Included session and weekly limits still apply to the subscription allowance.",
	},
	{
		question: "When should I keep Claude Pro or Max?",
		answer:
			"Keep it if the included Claude usage fits your work and you value the bundled web, mobile, and coding experience. DevPass is useful when you want a coding allowance across a different catalog; it does not replace Claude’s consumer apps.",
	},
];

const breadcrumbSchema = {
	"@context": "https://schema.org",
	"@type": "BreadcrumbList",
	itemListElement: [
		{ "@type": "ListItem", position: 1, name: "Home", item: BASE_URL },
		{
			"@type": "ListItem",
			position: 2,
			name: "Claude Code alternative",
			item: `${BASE_URL}${PAGE_PATH}`,
		},
	],
};

const faqSchema = {
	"@context": "https://schema.org",
	"@type": "FAQPage",
	mainEntity: faqs.map((item) => ({
		"@type": "Question",
		name: item.question,
		acceptedAnswer: {
			"@type": "Answer",
			text: item.answer,
		},
	})),
};

const planMath = (["lite", "pro", "max"] as const).map((tier) => ({
	tier,
	name: tier.charAt(0).toUpperCase() + tier.slice(1),
	price: DEV_PLAN_PRICES[tier],
	usage: getDevPlanCreditsLimit(tier),
}));

export default function ClaudeCodeAlternativePage() {
	return (
		<div className="min-h-screen bg-background">
			<script
				type="application/ld+json"
				// eslint-disable-next-line @eslint-react/dom/no-dangerously-set-innerhtml
				dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }}
			/>
			<script
				type="application/ld+json"
				// eslint-disable-next-line @eslint-react/dom/no-dangerously-set-innerhtml
				dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
			/>
			<Header />

			<main>
				{/* Hero */}
				<section className="relative overflow-hidden border-b">
					<div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_55%_55%_at_50%_-5%,_var(--tw-gradient-stops))] from-muted/70 via-transparent to-transparent" />
					<div
						className="pointer-events-none absolute inset-0 opacity-[0.04]"
						style={{
							backgroundImage:
								"linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)",
							backgroundSize: "44px 44px",
							maskImage:
								"radial-gradient(ellipse 70% 55% at 50% 0%, black, transparent)",
						}}
					/>
					<div className="container relative mx-auto max-w-3xl px-4 pt-16 pb-14 text-center sm:pt-24">
						<div className="mb-4 inline-flex items-center gap-2 rounded-full border border-border/60 bg-muted/50 px-4 py-1.5 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
							Claude Code alternative
						</div>
						<h1 className="text-4xl font-bold tracking-tight text-balance sm:text-5xl">
							The Claude Code alternative that keeps Claude Code
						</h1>
						<p className="mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-pretty text-muted-foreground">
							You don&apos;t have to give up the CLI to give up the $100–$200/mo
							Max subscription. DevPass is one key that runs{" "}
							{MARKETING_STATS.models} models — Claude included — through Claude
							Code or another compatible agent, metered at provider rates from $
							{DEV_PLAN_PRICES.lite}/mo. Monthly and premium weekly limits
							apply.
						</p>

						<div className="mt-9 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
							<GetDevPassButton
								signupHref="/signup?plan=pro"
								cta="get_started"
								location="claude_alternative_hero"
								showArrow
								className="gap-2"
							/>
							<Button size="lg" variant="ghost" asChild>
								<Link href="/pricing">See all plans</Link>
							</Button>
						</div>
					</div>
				</section>

				{/* Pain points */}
				<section className="px-4 py-14">
					<div className="container mx-auto max-w-5xl">
						<h2 className="mb-2 text-center text-2xl font-bold tracking-tight sm:text-3xl">
							Why developers go looking for an alternative
						</h2>
						<p className="mx-auto mb-10 max-w-2xl text-center text-sm text-muted-foreground">
							Compare the subscription, model access, and included limits
							alongside the coding workflow you already use.
						</p>
						<div className="grid gap-4 sm:grid-cols-3">
							{painPoints.map((point) => (
								<div
									key={point.title}
									className="rounded-2xl border bg-card p-6"
								>
									<point.icon className="h-5 w-5 text-muted-foreground" />
									<h3 className="mt-4 text-base font-semibold text-foreground">
										{point.title}
									</h3>
									<p className="mt-2 text-sm leading-6 text-muted-foreground">
										{point.body}
									</p>
								</div>
							))}
						</div>
					</div>
				</section>

				{/* Verdict */}
				<section className="px-4 pb-12">
					<div className="container mx-auto max-w-4xl">
						<div className="rounded-2xl border bg-muted/30 p-6 sm:p-8">
							<p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
								The short version
							</p>
							<p className="text-lg leading-relaxed text-foreground">
								Keep Claude Pro or Max if its usage and bundled apps fit your
								work. Choose DevPass for a monthly allowance across its live
								coding catalog in compatible tools. Both have usage limits and
								optional paid overflow; compare a representative workload before
								switching.
							</p>
						</div>
					</div>
				</section>

				{/* Comparison table */}
				<section className="px-4 pb-4">
					<div className="container mx-auto max-w-4xl">
						<h2 className="mb-2 text-2xl font-bold tracking-tight sm:text-3xl">
							DevPass vs Claude subscriptions at a glance
						</h2>
						<p className="mb-6 text-sm text-muted-foreground">
							Pricing and limits as of {FACTS_DATE} — always confirm current
							details in the official sources below.
						</p>
						<ComparisonTable
							competitor="Claude Pro / Max"
							competitorLogo="claude"
							features={comparisonFeatures}
						/>
					</div>
				</section>

				<section className="container mx-auto max-w-4xl px-4 py-8">
					<DevPassPlanChangeNotice />
				</section>

				{/* The math */}
				<section className="px-4 py-14">
					<div className="container mx-auto max-w-4xl">
						<h2 className="mb-2 text-2xl font-bold tracking-tight sm:text-3xl">
							What your money actually buys
						</h2>
						<p className="mb-8 max-w-3xl text-muted-foreground">
							As of {FACTS_DATE}, DevPass includes the monthly allowances below,
							with separate premium weekly limits. Requests consume the
							allowance at the selected model and provider rate. Claude Max
							offers 5× or 20× the Pro usage allowance; that is not directly
							convertible into a fixed number of tokens or DevPass dollars.
						</p>
						<div className="grid gap-4 sm:grid-cols-3">
							{planMath.map((plan) => (
								<div
									key={plan.tier}
									className="rounded-2xl border bg-card p-6 text-center"
								>
									<p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
										{plan.name}
									</p>
									<p className="mt-3 font-mono text-3xl font-bold tabular-nums text-foreground">
										${plan.price}
										<span className="text-sm font-medium text-muted-foreground">
											/mo
										</span>
									</p>
									<p className="mt-2 text-sm text-muted-foreground">
										~${plan.usage} of model usage
									</p>
								</div>
							))}
						</div>
						<p className="mt-6 text-sm text-muted-foreground">
							Compare that with Claude Max: $100/mo buys 5× and $200/mo buys 20×
							the Claude Pro quota — Anthropic models only, reset on a timer.
							Browse{" "}
							<Link
								href="/coding-models"
								className="underline underline-offset-4 hover:text-foreground"
							>
								the full model catalog
							</Link>{" "}
							or{" "}
							<Link
								href="/pricing"
								className="underline underline-offset-4 hover:text-foreground"
							>
								the plan details
							</Link>
							.
						</p>
					</div>
				</section>

				{/* Honest counterpoint */}
				<section className="border-t bg-muted/20 px-4 py-14">
					<div className="container mx-auto max-w-3xl">
						<h2 className="mb-6 text-2xl font-bold tracking-tight sm:text-3xl">
							When Claude Max is still the right call
						</h2>
						<div className="space-y-4 text-muted-foreground">
							<p>
								<strong className="text-foreground">
									Your work fits the Claude catalog and allowance.
								</strong>{" "}
								If the Claude catalog covers your work and usage fits the
								allowance, the bundled subscription can offer good value.
							</p>
							<p>
								<strong className="text-foreground">
									You want zero setup.
								</strong>{" "}
								Claude Code works out of the box on a Max plan. DevPass needs
								two environment variables — small, but not zero.
							</p>
							<p>
								<strong className="text-foreground">
									You live in the claude.ai apps.
								</strong>{" "}
								Max usage covers Claude chat and Claude Code together under one
								subscription. DevPass covers your coding tools; it doesn&apos;t
								replace a consumer chat plan.
							</p>
							<p>
								Comparing editors instead of subscriptions? See{" "}
								<Link
									href="/compare/cursor"
									className="underline underline-offset-4 hover:text-foreground"
								>
									DevPass vs Cursor
								</Link>{" "}
								or{" "}
								<Link
									href="/compare"
									className="underline underline-offset-4 hover:text-foreground"
								>
									all comparisons
								</Link>
								.
							</p>
						</div>
					</div>
				</section>

				<section className="container mx-auto max-w-3xl px-4 py-8 text-sm text-muted-foreground">
					<h2 className="font-semibold text-foreground">Official sources</h2>
					<ul className="mt-3 space-y-2">
						<li>
							<Link
								className="underline underline-offset-4"
								href="https://claude.com/pricing"
							>
								Claude plan pricing
							</Link>
						</li>
						<li>
							<Link
								className="underline underline-offset-4"
								href="https://support.claude.com/en/articles/11647753-how-do-usage-and-length-limits-work"
							>
								Claude usage limits
							</Link>
						</li>
						<li>
							<Link
								className="underline underline-offset-4"
								href="https://support.claude.com/en/articles/12429409-manage-usage-credits-for-paid-claude-plans"
							>
								Paid usage credits and spend controls
							</Link>
						</li>
						<li>
							<Link className="underline underline-offset-4" href="/pricing">
								DevPass pricing and limits
							</Link>
						</li>
					</ul>
				</section>

				{/* FAQ */}
				<section className="px-4 py-16">
					<div className="container mx-auto max-w-3xl">
						<h2 className="mb-8 text-2xl font-bold tracking-tight sm:text-3xl">
							Frequently asked questions
						</h2>
						<div className="divide-y divide-border/60">
							{faqs.map((item) => (
								<div key={item.question} className="py-5">
									<h3 className="text-lg font-medium text-foreground">
										{item.question}
									</h3>
									<p className="mt-2 leading-7 text-muted-foreground">
										{item.answer}
									</p>
								</div>
							))}
						</div>
					</div>
				</section>

				{/* Switch in 60 seconds */}
				<SwitchIn60 />

				{/* CTA */}
				<section className="border-t px-4 py-20">
					<div className="container mx-auto max-w-2xl text-center">
						<div className="mb-6 flex items-center justify-center gap-3">
							<BrandTile brand="devpass" size={44} radius={12} />
						</div>
						<h2 className="mb-3 text-3xl font-bold tracking-tight">
							Keep the CLI. Swap the subscription.
						</h2>
						<p className="mb-8 text-muted-foreground">
							Choose a plan that fits your monthly usage and review its premium
							limits before subscribing.
						</p>
						<div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
							<GetDevPassButton
								signupHref="/signup?plan=pro"
								cta="get_started"
								location="claude_alternative_bottom_cta"
								showArrow
								className="gap-2 px-8"
							/>
							<CodeCTATracker
								cta="see_pricing"
								location="claude_alternative_bottom_cta"
							>
								<Button size="lg" variant="ghost" asChild>
									<Link href="/pricing">
										See pricing
										<ArrowRight className="h-4 w-4" />
									</Link>
								</Button>
							</CodeCTATracker>
						</div>
					</div>
				</section>
			</main>

			<Footer />
		</div>
	);
}
