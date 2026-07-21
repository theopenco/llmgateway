import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { CodingModelsShowcase } from "@/components/CodingModelsShowcase";
import { Faq } from "@/components/Faq";
import { Footer } from "@/components/Footer";
import { GetDevPassButton } from "@/components/GetDevPassButton";
import { Header } from "@/components/Header";
import {
	CodeCTATracker,
	LandingPageTracker,
} from "@/components/LandingTracker";
import { PassportBook } from "@/components/PassportBook";
import { PricingPlans } from "@/components/PricingPlans";
import { TerminalPreview } from "@/components/TerminalPreview";
import { Button } from "@/components/ui/button";
import { FlickeringGrid } from "@/components/ui/flickering-grid";
import { Marquee } from "@/components/ui/marquee";
import { NumberTicker } from "@/components/ui/number-ticker";
import { getConfig } from "@/lib/config-server";

import {
	DEV_PLAN_PRICES,
	getDevPlanCreditsLimit,
	MARKETING_STATS,
} from "@llmgateway/shared";
import {
	AnthropicIcon,
	AutohandIcon,
	ClineIcon,
	DevPassCodeIcon,
	OpenCodeIcon,
	SoulForgeIcon,
} from "@llmgateway/shared/components";

import type { Metadata } from "next";

export const metadata: Metadata = {
	alternates: { canonical: "/" },
};

const modelCount = parseInt(MARKETING_STATS.models, 10);
const providerCount = parseInt(MARKETING_STATS.providers, 10);

const marqueeTools = [
	{ name: "DevPass Code", icon: DevPassCodeIcon },
	{ name: "Claude Code", icon: AnthropicIcon },
	{ name: "OpenCode", icon: OpenCodeIcon },
	{ name: "SoulForge", icon: SoulForgeIcon },
	{ name: "Autohand", icon: AutohandIcon },
	{ name: "Cline", icon: ClineIcon },
	{ name: "Cursor" },
	{ name: "Aider" },
	{ name: "Continue" },
] as const;

const featuredTools = [
	{
		name: "Claude Code",
		icon: AnthropicIcon,
		description:
			"Two env vars and Claude Code routes through LLM Gateway. Use any model — Claude, GPT-5, Gemini, GLM — with a single ANTHROPIC_MODEL flip.",
		setup: "ANTHROPIC_BASE_URL + AUTH_TOKEN",
	},
	{
		name: "OpenCode",
		icon: OpenCodeIcon,
		description:
			"LLM Gateway is built into OpenCode. Run `opencode`, type `/connect`, paste your DevPass key. No env vars, no config files.",
		setup: "/connect → LLM Gateway",
	},
	{
		name: "SoulForge",
		icon: SoulForgeIcon,
		description:
			"Graph-powered coding agent. Maps your repo on launch and edits TypeScript by symbol name, not by find-and-replace. Run `soulforge`, type `/keys`, paste your DevPass key.",
		setup: "/keys → paste your key",
	},
];

const steps = [
	{
		step: "01",
		title: "Pick a plan",
		description:
			"Choose Lite, Pro, or Max. Your DevPass key works everywhere — no separate keys per tool.",
	},
	{
		step: "02",
		title: "Plug it into your agent",
		description:
			"Two env vars for Claude Code, /connect in OpenCode, /keys in SoulForge. No SDK changes, no code refactor.",
	},
	{
		step: "03",
		title: "Switch models freely",
		description:
			"Claude Opus 4.8 for architecture, GPT-5.5 for review, Gemini 3.1 Pro for fresh eyes — same key, no extra cost.",
	},
];

export default function LandingPage() {
	const config = getConfig();
	const credits = {
		lite: getDevPlanCreditsLimit("lite"),
		pro: getDevPlanCreditsLimit("pro"),
		max: getDevPlanCreditsLimit("max"),
	};
	const usageRatio = Math.round(credits.lite / DEV_PLAN_PRICES.lite);

	return (
		<div className="min-h-screen bg-background">
			<LandingPageTracker />
			<Header />

			<main>
				{/* Hero */}
				<section className="relative overflow-hidden">
					<div
						aria-hidden
						className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] bg-[size:56px_56px] opacity-30 [mask-image:radial-gradient(ellipse_75%_60%_at_50%_0%,black,transparent_70%)]"
					/>
					<div
						aria-hidden
						className="pointer-events-none absolute inset-0 bg-[radial-gradient(55%_45%_at_75%_15%,rgba(16,185,129,0.09),transparent_60%)]"
					/>
					<div className="container relative mx-auto px-4 pt-16 pb-20 sm:pt-24 sm:pb-24">
						<div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
							<div>
								<div className="mb-6 inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-1.5 font-mono text-xs text-emerald-700 dark:text-emerald-400">
									<span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
									$1 in → $3 of model usage, at provider rates
								</div>
								<h1 className="font-display mb-6 text-5xl font-bold tracking-tight text-balance sm:text-6xl lg:text-7xl">
									One key.
									<br />
									Every model.
									<br />
									<span className="text-muted-foreground">
										Three flat prices.
									</span>
								</h1>
								<p className="mb-8 max-w-lg text-lg leading-relaxed text-muted-foreground">
									DevPass turns every dollar into{" "}
									<span className="font-mono font-semibold text-foreground">
										$3
									</span>{" "}
									of model usage at provider rates — metered transparently, with
									no token math and no lock-in. Best in{" "}
									<span className="font-semibold text-foreground">
										DevPass Code
									</span>
									, our first-party agent, and drop-in for every
									OpenAI-compatible tool.
								</p>
								<div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
									<GetDevPassButton
										cta="start_coding"
										location="hero"
										showArrow
										className="gap-2 bg-emerald-600 px-8 text-white shadow-lg shadow-emerald-600/25 hover:bg-emerald-500 dark:bg-emerald-500 dark:text-emerald-950 dark:hover:bg-emerald-400"
									/>
									<CodeCTATracker cta="view_plans" location="hero">
										<Button size="lg" variant="outline" asChild>
											<Link href="/pricing">See pricing</Link>
										</Button>
									</CodeCTATracker>
								</div>
								<p className="mt-5 font-mono text-xs text-muted-foreground">
									First-month guarantee — cancel within 7 days of your first
									purchase and we refund your first month, minus metered usage.
								</p>
							</div>

							<TerminalPreview />
						</div>
					</div>
				</section>

				{/* Works-with marquee + proof */}
				<section className="border-y bg-muted/20 py-12">
					<p className="mb-8 text-center font-mono text-xs uppercase tracking-[0.25em] text-muted-foreground">
						Works with every agent
					</p>
					<div className="relative">
						<div
							aria-hidden
							className="pointer-events-none absolute inset-y-0 left-0 z-10 w-24 bg-gradient-to-r from-background to-transparent"
						/>
						<div
							aria-hidden
							className="pointer-events-none absolute inset-y-0 right-0 z-10 w-24 bg-gradient-to-l from-background to-transparent"
						/>
						<Marquee pauseOnHover className="[--duration:36s] [--gap:3.5rem]">
							{marqueeTools.map((tool) => (
								<span
									key={tool.name}
									className="flex items-center gap-2.5 font-mono text-sm text-muted-foreground"
								>
									{"icon" in tool && tool.icon ? (
										<tool.icon className="h-4.5 w-4.5" />
									) : (
										<span className="h-1 w-1 rounded-full bg-emerald-500/70" />
									)}
									{tool.name}
								</span>
							))}
							<span className="flex items-center gap-2.5 font-mono text-sm text-muted-foreground">
								<span className="h-1 w-1 rounded-full bg-emerald-500/70" />
								any OpenAI-compatible tool
							</span>
						</Marquee>
					</div>

					<div className="container mx-auto mt-12 px-4">
						<div className="mx-auto grid max-w-3xl grid-cols-3 divide-x divide-border/60 text-center">
							<div className="px-2">
								<p className="font-display text-3xl font-bold tabular-nums sm:text-4xl">
									<NumberTicker value={modelCount} />+
								</p>
								<p className="mt-1 font-mono text-xs uppercase tracking-wider text-muted-foreground">
									Models
								</p>
							</div>
							<div className="px-2">
								<p className="font-display text-3xl font-bold tabular-nums sm:text-4xl">
									<NumberTicker value={providerCount} />+
								</p>
								<p className="mt-1 font-mono text-xs uppercase tracking-wider text-muted-foreground">
									Providers
								</p>
							</div>
							<div className="px-2">
								<p className="font-display text-3xl font-bold tabular-nums sm:text-4xl">
									<NumberTicker value={usageRatio} />×
								</p>
								<p className="mt-1 font-mono text-xs uppercase tracking-wider text-muted-foreground">
									Usage value
								</p>
							</div>
						</div>
						<p className="mt-8 text-center font-mono text-xs text-muted-foreground">
							Runs on the open-source LLM Gateway —{" "}
							{MARKETING_STATS.tokensRouted} tokens routed ·{" "}
							<a
								href="https://github.com/theopenco/llmgateway"
								target="_blank"
								rel="noopener noreferrer"
								className="text-foreground underline-offset-4 hover:underline"
							>
								{MARKETING_STATS.githubStars} GitHub stars
							</a>
						</p>
					</div>
				</section>

				{/* Pricing */}
				<section id="pricing" className="scroll-mt-16 py-24 px-4">
					<div className="container mx-auto max-w-6xl">
						<div className="mx-auto mb-14 max-w-2xl text-center">
							<p className="mb-3 font-mono text-xs uppercase tracking-[0.25em] text-muted-foreground">
								The meter
							</p>
							<h2 className="font-display mb-4 text-3xl font-bold tracking-tight sm:text-5xl">
								What you pay vs. what you get
							</h2>
							<p className="text-muted-foreground">
								Every plan includes the full {MARKETING_STATS.models} model
								catalog. The only things that change are your monthly usage
								allowance and the weekly fair-use cap on premium models.
							</p>
						</div>
						<PricingPlans credits={credits} paygoUrl={config.uiUrl} />

						{/* Price check — ledger note */}
						<div className="mx-auto mt-12 max-w-2xl rounded-2xl border border-dashed p-6 sm:p-8">
							<p className="mb-5 font-mono text-xs uppercase tracking-[0.25em] text-muted-foreground">
								Price check
							</p>
							<dl className="space-y-3 font-mono text-sm">
								<div className="flex items-baseline justify-between gap-4">
									<dt className="text-muted-foreground">API pay-as-you-go</dt>
									<dd className="text-right tabular-nums">
										$29{" "}
										<span className="text-muted-foreground">
											→ $29 of usage
										</span>
									</dd>
								</div>
								<div className="border-t border-dashed" />
								<div className="flex items-baseline justify-between gap-4">
									<dt className="text-muted-foreground">Cursor Pro</dt>
									<dd className="text-right tabular-nums">
										$20/mo{" "}
										<span className="text-muted-foreground">
											→ about $20 of usage
										</span>
									</dd>
								</div>
								<div className="border-t border-dashed" />
								<div className="flex items-baseline justify-between gap-4">
									<dt className="font-semibold">DevPass Lite</dt>
									<dd className="text-right font-semibold tabular-nums">
										$29/mo{" "}
										<span className="font-normal text-emerald-600 dark:text-emerald-400">
											→ {`$${credits.lite}`} at provider rates
										</span>
									</dd>
								</div>
							</dl>
							<p className="mt-5 text-sm leading-relaxed text-muted-foreground">
								Same dollars, 3× the metered usage — in whatever editor or agent
								you already use.
							</p>
							<CodeCTATracker cta="compare_cursor" location="pricing">
								<Button
									size="sm"
									variant="ghost"
									asChild
									className="mt-3 -ml-3"
								>
									<Link href="/compare/cursor">
										See the full DevPass vs Cursor comparison
										<ArrowRight className="h-3.5 w-3.5" />
									</Link>
								</Button>
							</CodeCTATracker>
						</div>
					</div>
				</section>

				{/* Passport control */}
				<section className="border-t bg-muted/20 py-24 px-4">
					<div className="container mx-auto max-w-6xl">
						<div className="mx-auto mb-14 max-w-2xl text-center">
							<p className="mb-3 font-mono text-xs uppercase tracking-[0.25em] text-muted-foreground">
								Passport control
							</p>
							<h2 className="font-display mb-3 text-3xl font-bold tracking-tight sm:text-5xl">
								One passport. Every agent stamped in.
							</h2>
							<p className="text-muted-foreground">
								<span className="font-semibold text-foreground">
									DevPass Code
								</span>{" "}
								— our own terminal agent — is the bearer: one-click browser
								login, no keys to copy. Claude Code, OpenCode, SoulForge, and
								every OpenAI-compatible tool get stamped in with two env vars.
							</p>
						</div>

						<PassportBook />

						<div className="mt-16 grid gap-5 md:grid-cols-3">
							{featuredTools.map((tool) => {
								const Icon = tool.icon;
								return (
									<div
										key={tool.name}
										className="flex flex-col rounded-2xl border bg-card p-6 transition-all hover:border-emerald-500/30 hover:shadow-md"
									>
										<div className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl bg-foreground text-background">
											<Icon className="h-5 w-5" />
										</div>
										<h3 className="font-display mb-2 text-lg font-semibold">
											{tool.name}
										</h3>
										<p className="mb-5 flex-1 text-sm leading-relaxed text-muted-foreground">
											{tool.description}
										</p>
										<div className="rounded-md border border-dashed bg-muted/40 px-3 py-2 font-mono text-xs text-muted-foreground">
											{tool.setup}
										</div>
									</div>
								);
							})}
						</div>
						<div className="mt-8 flex items-center justify-center gap-2 font-mono text-xs text-muted-foreground">
							<span className="h-px w-12 bg-border" />
							<span>
								+ Cline, Cursor, Aider, Continue & any OpenAI-compatible tool
							</span>
							<span className="h-px w-12 bg-border" />
						</div>
					</div>
				</section>

				{/* How it works */}
				<section className="border-t py-24 px-4">
					<div className="container mx-auto max-w-6xl">
						<div className="mb-14 text-center">
							<p className="mb-3 font-mono text-xs uppercase tracking-[0.25em] text-muted-foreground">
								How it works
							</p>
							<h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
								Up and running in minutes
							</h2>
						</div>
						<div className="grid gap-10 md:grid-cols-3 md:gap-6">
							{steps.map((item) => (
								<div
									key={item.step}
									className="relative border-t border-dashed pt-6"
								>
									<span className="font-display absolute -top-5 left-0 bg-background pr-3 text-3xl font-bold tabular-nums text-emerald-600/80 dark:text-emerald-400/80">
										{item.step}
									</span>
									<h3 className="mb-2 font-semibold">{item.title}</h3>
									<p className="text-sm leading-relaxed text-muted-foreground">
										{item.description}
									</p>
								</div>
							))}
						</div>
					</div>
				</section>

				{/* Models showcase */}
				<section className="border-t bg-muted/20 py-24 px-4">
					<div className="container mx-auto max-w-6xl">
						<div className="mb-10 max-w-2xl">
							<p className="mb-3 font-mono text-xs uppercase tracking-[0.25em] text-muted-foreground">
								The latest flagships
							</p>
							<h2 className="font-display mb-3 text-3xl font-bold tracking-tight sm:text-4xl">
								Every plan ships with the newest models
							</h2>
							<p className="text-muted-foreground">
								Claude Opus 4.8, Gemini 3.1 Pro, GPT-5.5, plus the strongest
								open-weight Chinese coders — included on every tier.
							</p>
						</div>
						<CodingModelsShowcase />
					</div>
				</section>

				{/* FAQ */}
				<Faq />

				{/* Final CTA */}
				<section className="relative overflow-hidden border-t py-28 px-4">
					<FlickeringGrid
						className="absolute inset-0 [mask-image:radial-gradient(560px_circle_at_center,white,transparent)]"
						squareSize={4}
						gridGap={6}
						color="#10b981"
						maxOpacity={0.18}
						flickerChance={0.1}
					/>
					<div className="container relative mx-auto max-w-2xl text-center">
						<h2 className="font-display mb-4 text-4xl font-bold tracking-tight sm:text-5xl">
							Stop watching your token balance
						</h2>
						<p className="mb-9 text-lg text-muted-foreground">
							Pick a plan, set two env vars, get back to building.
						</p>
						<div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
							<GetDevPassButton
								cta="get_started"
								location="bottom_cta"
								showArrow
								className="gap-2 bg-emerald-600 px-8 text-white shadow-lg shadow-emerald-600/25 hover:bg-emerald-500 dark:bg-emerald-500 dark:text-emerald-950 dark:hover:bg-emerald-400"
							/>
							<CodeCTATracker cta="browse_models" location="bottom_cta">
								<Button size="lg" variant="ghost" asChild>
									<Link href="/coding-models">Browse all models</Link>
								</Button>
							</CodeCTATracker>
						</div>
						<p className="mt-6 font-mono text-xs text-muted-foreground">
							First-month guarantee · no lock-in · no cancellation fee
						</p>
					</div>
				</section>
			</main>

			<Footer />
		</div>
	);
}
