import { Check, X } from "lucide-react";
import Link from "next/link";

import { StartFaq } from "@/app/start/StartFaq";
import { Footer } from "@/components/Footer";
import { GetDevPassButton } from "@/components/GetDevPassButton";
import { Header } from "@/components/Header";
import { CodeCTATracker, StartPageTracker } from "@/components/LandingTracker";
import { PricingPlans } from "@/components/PricingPlans";
import { Button } from "@/components/ui/button";
import { FlickeringGrid } from "@/components/ui/flickering-grid";
import { Marquee } from "@/components/ui/marquee";
import { marqueeTools } from "@/lib/agent-tools";
import { formatUsageRatio } from "@/lib/utils";

import {
	DEV_PLAN_PRICES,
	getDevPlanCreditsLimit,
	MARKETING_STATS,
	SELF_REFUND_USAGE_PERCENT,
	SELF_REFUND_WINDOW_DAYS,
} from "@llmgateway/shared";

import type { Metadata } from "next";

export const metadata: Metadata = {
	title: { absolute: "AI Coding Subscription — DevPass by LLM Gateway" },
	description: `One flat-rate AI coding subscription for every model and every agent. Claude, GPT, Gemini and ${MARKETING_STATS.models} more models in the coding agent you already use — from $${DEV_PLAN_PRICES.lite}/month.`,
	robots: { index: false, follow: false },
};

const steps = [
	{
		step: "01",
		title: "Pick a plan",
		description: `Lite, Pro, or Max — one flat monthly price from $${DEV_PLAN_PRICES.lite}. Switch or cancel anytime, no lock-in.`,
	},
	{
		step: "02",
		title: "Paste your key in your agent",
		description:
			"Two env vars for Claude Code, /connect in OpenCode, /keys in Empryo — or one-click login in DevPass Code. No SDK changes.",
	},
	{
		step: "03",
		title: "Code with any model",
		description: `Claude, GPT-5, Gemini, GLM, Qwen and ${MARKETING_STATS.models} more — switch models freely with the same key.`,
	},
] as const;

const directItems = [
	{ label: "Claude subscription", value: "typically $100–200/mo" },
	{ label: "A second agent's plan", value: "typically ~$20/mo" },
	{ label: "API keys for other models", value: "unpredictable bills" },
	{ label: "Model access", value: "locked per vendor" },
] as const;

const devpassItems = [
	{
		label: "All models",
		value: `${MARKETING_STATS.models} models, ${MARKETING_STATS.providers} providers`,
	},
	{ label: "One flat price", value: `from $${DEV_PLAN_PRICES.lite}/mo` },
	{ label: "Metering", value: "transparent, provider rates" },
	{ label: "Lock-in", value: "none — cancel anytime" },
] as const;

export default function StartPage() {
	const credits = {
		lite: getDevPlanCreditsLimit("lite"),
		pro: getDevPlanCreditsLimit("pro"),
		max: getDevPlanCreditsLimit("max"),
	};
	const usageRatio = formatUsageRatio(credits.lite, DEV_PLAN_PRICES.lite);

	return (
		<div className="min-h-screen bg-background">
			<StartPageTracker />
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
						className="pointer-events-none absolute inset-0 bg-[radial-gradient(55%_45%_at_50%_10%,rgba(16,185,129,0.09),transparent_60%)]"
					/>
					<div className="container relative mx-auto px-4 pt-16 pb-16 sm:pt-24 sm:pb-20">
						<div className="mx-auto max-w-3xl text-center">
							<div className="mb-6 inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-1.5 font-mono text-xs text-emerald-700 dark:text-emerald-400">
								<span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
								AI coding subscription · from ${DEV_PLAN_PRICES.lite}/mo
							</div>
							<h1 className="font-display mb-6 text-4xl font-bold tracking-tight text-balance sm:text-6xl">
								One AI coding subscription.
								<br />
								<span className="text-muted-foreground">
									Every model, every agent.
								</span>
							</h1>
							<p className="mx-auto mb-8 max-w-xl text-lg leading-relaxed text-muted-foreground">
								Claude, GPT, Gemini and {MARKETING_STATS.models} more models in
								the coding agent you already use — from ${DEV_PLAN_PRICES.lite}
								/month.
							</p>
							<div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
								<GetDevPassButton
									cta="get_started"
									location="start_hero"
									signupHref="/signup?plan=lite"
									showArrow
									className="gap-2 bg-emerald-600 px-8 text-white shadow-lg shadow-emerald-600/25 hover:bg-emerald-500 dark:bg-emerald-500 dark:text-emerald-950 dark:hover:bg-emerald-400"
								/>
								<CodeCTATracker cta="see_plans" location="start_hero">
									<Button size="lg" variant="outline" asChild>
										<Link href="#pricing">See plans</Link>
									</Button>
								</CodeCTATracker>
							</div>
							<p className="mt-5 font-mono text-xs text-muted-foreground">
								First-month guarantee — if you&apos;ve used less than{" "}
								{SELF_REFUND_USAGE_PERCENT}% of your allowance, refund yourself
								from your billing dashboard within {SELF_REFUND_WINDOW_DAYS}{" "}
								days of your first purchase.
							</p>
						</div>
					</div>
				</section>

				{/* Agents strip */}
				<section className="border-y bg-muted/20 py-12">
					<p className="mb-8 text-center font-mono text-xs uppercase tracking-[0.25em] text-muted-foreground">
						Works with the agent you already use
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
					<p className="container mx-auto mt-10 px-4 text-center font-mono text-xs text-muted-foreground">
						Runs on the open-source LLM Gateway — {MARKETING_STATS.tokensRouted}{" "}
						tokens routed · {MARKETING_STATS.githubStars} GitHub stars
					</p>
				</section>

				{/* How it works */}
				<section className="py-20 px-4 sm:py-24">
					<div className="container mx-auto max-w-6xl">
						<div className="mb-14 text-center">
							<p className="mb-3 font-mono text-xs uppercase tracking-[0.25em] text-muted-foreground">
								How it works
							</p>
							<h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
								Coding with every model in minutes
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

				{/* Cost comparison */}
				<section className="border-t bg-muted/20 py-20 px-4 sm:py-24">
					<div className="container mx-auto max-w-4xl">
						<div className="mx-auto mb-12 max-w-2xl text-center">
							<p className="mb-3 font-mono text-xs uppercase tracking-[0.25em] text-muted-foreground">
								The math
							</p>
							<h2 className="font-display mb-3 text-3xl font-bold tracking-tight sm:text-4xl">
								Skip the subscription stack
							</h2>
							<p className="text-muted-foreground">
								Using more than one model today usually means paying more than
								one vendor. DevPass replaces the stack with a single metered
								plan.
							</p>
						</div>
						<div className="grid gap-5 md:grid-cols-2">
							<div className="rounded-2xl border bg-card p-7">
								<p className="mb-5 font-mono text-xs uppercase tracking-[0.25em] text-muted-foreground">
									Paying providers directly
								</p>
								<dl className="divide-y divide-dashed divide-border font-mono text-sm">
									{directItems.map((item) => (
										<div
											key={item.label}
											className="flex items-baseline justify-between gap-4 py-2.5 first:pt-0 last:pb-0"
										>
											<dt className="flex items-center gap-2 text-muted-foreground">
												<X className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
												{item.label}
											</dt>
											<dd className="text-right">{item.value}</dd>
										</div>
									))}
								</dl>
								<p className="mt-5 text-sm leading-relaxed text-muted-foreground">
									Several subscriptions, several keys — and each one locked to
									its own vendor&apos;s models.
								</p>
							</div>
							<div className="rounded-2xl border border-emerald-500/40 bg-card p-7 shadow-lg shadow-emerald-500/10 ring-1 ring-emerald-500/20">
								<p className="mb-5 font-mono text-xs uppercase tracking-[0.25em] text-emerald-600 dark:text-emerald-400">
									One DevPass subscription
								</p>
								<dl className="divide-y divide-dashed divide-border font-mono text-sm">
									{devpassItems.map((item) => (
										<div
											key={item.label}
											className="flex items-baseline justify-between gap-4 py-2.5 first:pt-0 last:pb-0"
										>
											<dt className="flex items-center gap-2 text-muted-foreground">
												<Check className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
												{item.label}
											</dt>
											<dd className="text-right font-semibold">{item.value}</dd>
										</div>
									))}
								</dl>
								<p className="mt-5 text-sm leading-relaxed text-muted-foreground">
									Up to {usageRatio} the model usage for every dollar, metered
									at each provider&apos;s published per-token rate.
								</p>
							</div>
						</div>
						<p className="mt-4 text-center text-xs text-muted-foreground">
							Third-party prices are typical published rates and vary by vendor
							and tier.
						</p>
					</div>
				</section>

				{/* Pricing */}
				<section
					id="pricing"
					className="scroll-mt-16 border-t py-20 px-4 sm:py-24"
				>
					<div className="container mx-auto max-w-6xl">
						<div className="mx-auto mb-14 max-w-2xl text-center">
							<p className="mb-3 font-mono text-xs uppercase tracking-[0.25em] text-muted-foreground">
								Pricing
							</p>
							<h2 className="font-display mb-4 text-3xl font-bold tracking-tight sm:text-5xl">
								Three flat plans. Every model on all of them.
							</h2>
							<p className="text-muted-foreground">
								Every plan includes the full {MARKETING_STATS.models} model
								catalog. The only things that change are your monthly usage
								allowance and the weekly fair-use cap on premium models.
							</p>
						</div>
						<PricingPlans credits={credits} />
					</div>
				</section>

				{/* FAQ */}
				<section className="border-t bg-muted/20 py-20 px-4 sm:py-24">
					<div className="container mx-auto max-w-3xl">
						<div className="mb-10 text-center">
							<p className="mb-3 font-mono text-xs uppercase tracking-[0.25em] text-muted-foreground">
								FAQ
							</p>
							<h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
								Quick answers
							</h2>
						</div>
						<StartFaq />
					</div>
				</section>

				{/* Final CTA */}
				<section className="relative overflow-hidden border-t py-24 px-4 sm:py-28">
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
							One subscription. Every model.
						</h2>
						<p className="mb-9 text-lg text-muted-foreground">
							Pick a plan, paste your key, get back to building.
						</p>
						<div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
							<GetDevPassButton
								cta="get_started"
								location="start_bottom_cta"
								signupHref="/signup?plan=lite"
								showArrow
								className="gap-2 bg-emerald-600 px-8 text-white shadow-lg shadow-emerald-600/25 hover:bg-emerald-500 dark:bg-emerald-500 dark:text-emerald-950 dark:hover:bg-emerald-400"
							/>
							<CodeCTATracker cta="see_plans" location="start_bottom_cta">
								<Button size="lg" variant="ghost" asChild>
									<Link href="#pricing">Compare plans</Link>
								</Button>
							</CodeCTATracker>
						</div>
						<p className="mt-6 font-mono text-xs text-muted-foreground">
							First-month guarantee — barely used it? Refund yourself from your
							billing dashboard within {SELF_REFUND_WINDOW_DAYS} days of your
							first purchase.
						</p>
					</div>
				</section>
			</main>

			<Footer />
		</div>
	);
}
