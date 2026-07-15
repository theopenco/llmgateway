import { ArrowRight, DollarSign, Gauge, Layers } from "lucide-react";
import Link from "next/link";

import { BrandTile } from "@/components/brand-logos";
import { ComparisonTable } from "@/components/ComparisonTable";
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

const TITLE = "Claude Code Alternative (2026): Keep the CLI, Skip the Caps";
const DESCRIPTION = `Looking for a Claude Code alternative? DevPass keeps the Claude Code CLI and replaces the Max subscription: one key, 200+ models (Claude included) metered at provider rates, from $${DEV_PLAN_PRICES.lite}/mo. No weekly caps.`;

export const metadata: Metadata = {
	title: TITLE,
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

const FACTS_DATE = "July 13, 2026";

const painPoints = [
	{
		icon: Gauge,
		title: "Weekly caps you can't see",
		body: "Max plans stack a 5-hour rolling limit with two weekly ceilings — one across all models, another for the top models — and Anthropic doesn't publish the actual quotas. Hit one mid-sprint and you wait it out.",
	},
	{
		icon: DollarSign,
		title: "$100–$200/mo for one vendor",
		body: "Max 5× is $100/mo and Max 20× is $200/mo, and every dollar of it is locked to Anthropic models. The moment you want a second model family, you're buying a second subscription.",
	},
	{
		icon: Layers,
		title: "One model family",
		body: "No GPT-5.5 when you want a different reasoning style, no Gemini for long context, no GLM, Kimi or Qwen when cheap throughput would do. The subscription decides your stack for you.",
	},
];

const comparisonFeatures = [
	{
		label: "Starting price",
		devpass: `$${DEV_PLAN_PRICES.lite}/mo (Lite)`,
		competitor: "$100/mo (Max 5×)",
		highlight: true,
	},
	{
		label: "Models available",
		devpass: `${MARKETING_STATS.models} — Claude included`,
		competitor: "Claude family only",
		highlight: true,
	},
	{
		label: "Usage you can see",
		devpass: "Metered in real dollars, per request",
		competitor: "Opaque 5×/20× multipliers",
		highlight: true,
	},
	{
		label: "Weekly usage caps",
		devpass: "None — dollar allowance (~3× plan price)",
		competitor: "Two weekly caps + 5-hour window",
		highlight: true,
	},
	{
		label: "Works with the Claude Code CLI",
		devpass: true,
		competitor: true,
	},
	{
		label: "Works with DevPass Code, OpenCode, Cursor, Zed, Cline",
		devpass: true,
		competitor: false,
	},
	{
		label: "Mix models mid-project",
		devpass: true,
		competitor: false,
	},
	{
		label: "API compatibility",
		devpass: "OpenAI + Anthropic compatible",
		competitor: "Anthropic only",
	},
];

const faqs = [
	{
		question: "What is the best Claude Code alternative?",
		answer: `It depends on what you're trying to escape. If it's the Claude Max price, the weekly caps or the Anthropic-only catalog — but you like the Claude Code workflow — DevPass is built for exactly that: keep the CLI, point it at one key, and get 200+ models (Claude included) metered at provider rates from $${DEV_PLAN_PRICES.lite}/mo. If what you want is a different editor experience entirely, look at tools like Cursor instead.`,
	},
	{
		question: "Can I keep using the Claude Code CLI with DevPass?",
		answer:
			"Yes. Claude Code accepts a custom endpoint, so switching is two environment variables: set ANTHROPIC_BASE_URL to the DevPass endpoint and ANTHROPIC_AUTH_TOKEN to your DevPass key, then run claude as usual. No reinstall, no SDK changes — and you can flip ANTHROPIC_MODEL to run non-Anthropic models through the same CLI.",
	},
	{
		question: "How much cheaper is DevPass than Claude Max?",
		answer: `Claude Max costs $100/mo (5×) or $200/mo (20×) of an unpublished usage quota, Anthropic models only. DevPass plans are $${DEV_PLAN_PRICES.lite} (Lite), $${DEV_PLAN_PRICES.pro} (Pro) and $${DEV_PLAN_PRICES.max} (Max), and each includes roughly 3× its price in metered model usage at the providers' published rates — about $${getDevPlanCreditsLimit("lite")}, $${getDevPlanCreditsLimit("pro")} and $${getDevPlanCreditsLimit("max")} respectively — across 200+ models. Whether that's cheaper for you depends on your usage, but you can read your burn in real dollars instead of guessing at a multiplier.`,
	},
	{
		question: "Does DevPass include Claude models?",
		answer:
			"Yes. Claude Opus, Sonnet and Haiku are all available through DevPass at Anthropic's published per-token rates, next to GPT-5.5, Gemini 3.1 Pro and 200+ other frontier and open-weight models — all under the same key.",
	},
	{
		question: "Does DevPass have weekly usage limits like Claude Max?",
		answer:
			"No. There are no 5-hour windows and no weekly caps. Each plan includes a monthly dollar allowance (about 3× the plan price) metered per request at provider rates. If you run through it, you can top up or move up a tier — you're never waiting for a timer to reset.",
	},
	{
		question: "What about Claude Pro at $20/mo?",
		answer: `Claude Pro includes Claude Code access, but with a small usage quota that serious daily coding work outgrows quickly — that's what the Max tiers are for. DevPass Lite at $${DEV_PLAN_PRICES.lite}/mo includes about $${getDevPlanCreditsLimit("lite")} of metered usage across every model, so it's the closer comparison for daily driving.`,
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
							Code or any agent you like, metered at provider rates from $
							{DEV_PLAN_PRICES.lite}/mo. No weekly caps.
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
							Claude Code the CLI is excellent. The complaints are almost always
							about the subscription underneath it.
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
								Most people searching for a Claude Code alternative don&apos;t
								want to lose Claude Code — they want to lose the bill and the
								caps. DevPass does exactly that: point the CLI you already use
								at one key that meters {MARKETING_STATS.models} models, Claude
								included, at the providers&apos; own published rates. Swap the
								agent too if you want — <strong>DevPass Code</strong>, OpenCode,
								Cursor, Zed and Cline all take the same key.
							</p>
						</div>
					</div>
				</section>

				{/* Comparison table */}
				<section className="px-4 pb-4">
					<div className="container mx-auto max-w-4xl">
						<h2 className="mb-2 text-2xl font-bold tracking-tight sm:text-3xl">
							DevPass vs Claude Max at a glance
						</h2>
						<p className="mb-6 text-sm text-muted-foreground">
							Pricing and limits as of {FACTS_DATE} — always confirm current
							details on anthropic.com.
						</p>
						<ComparisonTable
							competitor="Claude Max"
							competitorLogo="claude"
							features={comparisonFeatures}
						/>
					</div>
				</section>

				{/* The math */}
				<section className="px-4 py-14">
					<div className="container mx-auto max-w-4xl">
						<h2 className="mb-2 text-2xl font-bold tracking-tight sm:text-3xl">
							What your money actually buys
						</h2>
						<p className="mb-8 max-w-3xl text-muted-foreground">
							Claude Max sells multipliers of a quota Anthropic doesn&apos;t
							publish. DevPass sells a number you can read: every plan includes
							roughly 3× its price in model usage, metered per request at each
							provider&apos;s published per-token rate. When Claude Opus is the
							right tool you pay Anthropic&apos;s rate for it; when GLM or Qwen
							will do, the same allowance stretches several times further.
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
									You only ever use Claude models and rarely hit the caps.
								</strong>{" "}
								If Opus and Sonnet are your whole stack and your usage fits the
								quota, Max&apos;s flat, no-meter feel is genuinely pleasant.
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
							Start on Pro — most developers ship from there. Upgrade any time
							and your new allowance kicks in instantly.
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
