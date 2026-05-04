import {
	ArrowRight,
	Calculator,
	Check,
	HelpCircle,
	Minus,
	Sparkles,
} from "lucide-react";
import Link from "next/link";

import { Faq } from "@/components/Faq";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { CodeCTATracker } from "@/components/LandingTracker";
import { PricingPlans } from "@/components/PricingPlans";
import { SoulForgeBoost } from "@/components/SoulForgeBoost";
import { Button } from "@/components/ui/button";
import { getConfig } from "@/lib/config-server";

import {
	DEV_PLAN_ANNUAL_DISCOUNT_MONTHS,
	DEV_PLAN_PRICES,
	getDevPlanAnnualPrice,
	getDevPlanCreditsLimit,
} from "@llmgateway/shared";

import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "Pricing — DevPass",
	description:
		"Flat-rate AI coding plans. Lite, Pro, and Max — every plan includes 200+ models. Pair with SoulForge to cut another ~50% of tokens.",
	openGraph: {
		title: "Pricing — DevPass",
		description:
			"Flat-rate AI coding plans. Every plan includes 200+ models — Claude Opus 4.7, GPT-5.5, Gemini 3.1 Pro, GLM-4.7, and more.",
	},
};

interface UsageRow {
	label: string;
	lite: string | boolean;
	pro: string | boolean;
	max: string | boolean;
	emphasis?: boolean;
}

function formatUsd(amount: number): string {
	return Number.isInteger(amount)
		? `$${amount}`
		: `$${amount.toFixed(2).replace(/\.?0+$/, "")}`;
}

const liteCredits = getDevPlanCreditsLimit("lite");
const proCredits = getDevPlanCreditsLimit("pro");
const maxCredits = getDevPlanCreditsLimit("max");

const usageRows: UsageRow[] = [
	{
		label: "You pay",
		lite: `${formatUsd(DEV_PLAN_PRICES.lite)}/mo`,
		pro: `${formatUsd(DEV_PLAN_PRICES.pro)}/mo`,
		max: `${formatUsd(DEV_PLAN_PRICES.max)}/mo`,
	},
	{
		label: "Monthly model usage at provider rates",
		lite: formatUsd(liteCredits),
		pro: formatUsd(proCredits),
		max: formatUsd(maxCredits),
		emphasis: true,
	},
	{
		label: "Effective with SoulForge (~50% token cut)",
		lite: `~${formatUsd(liteCredits * 2)}`,
		pro: `~${formatUsd(proCredits * 2)}`,
		max: `~${formatUsd(maxCredits * 2)}`,
	},
	{
		label: "Models included",
		lite: "200+",
		pro: "200+",
		max: "200+",
	},
	{
		label: "Latest flagships (Opus 4.7, GPT-5.5, Gemini 3.1 Pro)",
		lite: true,
		pro: true,
		max: true,
	},
	{
		label: "Open-weight Chinese coders (GLM-4.7, Qwen3, Kimi K2.6)",
		lite: true,
		pro: true,
		max: true,
	},
	{
		label: "Works with Claude Code, OpenCode, SoulForge",
		lite: true,
		pro: true,
		max: true,
	},
	{
		label: "Any OpenAI/Anthropic-compatible tool",
		lite: true,
		pro: true,
		max: true,
	},
	{
		label: "Real-time usage dashboard",
		lite: true,
		pro: true,
		max: true,
	},
	{
		label: "Per-request cost & latency analytics",
		lite: true,
		pro: true,
		max: true,
	},
	{
		label: "Switch tiers anytime (prorated)",
		lite: true,
		pro: true,
		max: true,
	},
	{
		label: `Annual billing (save ${DEV_PLAN_ANNUAL_DISCOUNT_MONTHS} months)`,
		lite: true,
		pro: true,
		max: true,
	},
	{
		label: "Email support",
		lite: true,
		pro: true,
		max: true,
	},
	{
		label: "Priority support",
		lite: false,
		pro: true,
		max: true,
	},
	{
		label: "Headroom for all-day agent runs",
		lite: false,
		pro: false,
		max: true,
	},
];

function Cell({
	value,
	emphasis,
}: {
	value: string | boolean;
	emphasis?: boolean;
}) {
	if (typeof value === "boolean") {
		return (
			<>
				{value ? (
					<Check
						aria-hidden="true"
						className="mx-auto h-4 w-4 text-foreground/70"
					/>
				) : (
					<Minus
						aria-hidden="true"
						className="mx-auto h-4 w-4 text-muted-foreground/40"
					/>
				)}
				<span className="sr-only">{value ? "Included" : "Not included"}</span>
			</>
		);
	}
	return (
		<span
			className={`font-mono text-sm tabular-nums ${
				emphasis ? "font-bold text-foreground" : "font-medium text-foreground"
			}`}
		>
			{value}
		</span>
	);
}

export default function PricingPage() {
	const config = getConfig();
	const calculatorUrl = `${config.uiUrl}/token-cost-calculator`;

	return (
		<div className="min-h-screen bg-background">
			<Header />

			<main>
				<section className="relative overflow-hidden">
					<div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-muted/60 via-transparent to-transparent" />
					<div className="container relative mx-auto px-4 pt-20 pb-12 sm:pt-24">
						<div className="mx-auto max-w-3xl text-center">
							<div className="mb-6 inline-flex items-center gap-2 rounded-full border border-border/60 bg-muted/50 px-4 py-1.5 text-sm text-muted-foreground">
								<Sparkles className="h-3.5 w-3.5" />
								Pricing &amp; plans
							</div>
							<h1 className="mb-5 text-4xl font-bold tracking-tight sm:text-5xl">
								Flat rate. Every model.
								<br />
								<span className="text-muted-foreground">No token math.</span>
							</h1>
							<p className="mx-auto max-w-xl text-lg leading-relaxed text-muted-foreground">
								Every dollar you pay turns into{" "}
								<span className="font-semibold text-foreground">$3</span> of
								model usage at provider rates — and roughly{" "}
								<span className="font-semibold text-foreground">$6</span> when
								you pair DevPass with SoulForge.
							</p>
						</div>
					</div>
				</section>

				<section id="plans" className="scroll-mt-20 py-12 px-4">
					<div className="container mx-auto max-w-6xl">
						<PricingPlans
							credits={{
								lite: liteCredits,
								pro: proCredits,
								max: maxCredits,
							}}
						/>
					</div>
				</section>

				<SoulForgeBoost />

				<section className="py-20 px-4">
					<div className="container mx-auto max-w-5xl">
						<div className="mb-12 max-w-2xl">
							<p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
								Compare plans
							</p>
							<h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
								What&apos;s in each plan
							</h2>
							<p className="mt-3 text-muted-foreground">
								Every tier ships with the full model catalog. The only thing
								that changes is how much usage you have to play with each month.
							</p>
						</div>

						<div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
							<div className="overflow-x-auto">
								<table className="w-full text-left text-sm">
									<thead>
										<tr className="border-b bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
											<th className="px-5 py-4 font-medium">Feature</th>
											<th className="px-5 py-4 text-center font-medium">
												<div className="font-semibold text-foreground">
													Lite
												</div>
												<div className="mt-0.5 text-xs font-normal text-muted-foreground normal-case tracking-normal tabular-nums">
													${DEV_PLAN_PRICES.lite}/mo · $
													{getDevPlanAnnualPrice("lite")}
													/yr
												</div>
											</th>
											<th className="px-5 py-4 text-center font-medium">
												<div className="font-semibold text-foreground">
													Pro
													<span className="ml-1.5 rounded-full bg-foreground px-1.5 py-0.5 text-[9px] font-semibold text-background">
														POPULAR
													</span>
												</div>
												<div className="mt-0.5 text-xs font-normal text-muted-foreground normal-case tracking-normal tabular-nums">
													${DEV_PLAN_PRICES.pro}/mo · $
													{getDevPlanAnnualPrice("pro")}
													/yr
												</div>
											</th>
											<th className="px-5 py-4 text-center font-medium">
												<div className="font-semibold text-foreground">Max</div>
												<div className="mt-0.5 text-xs font-normal text-muted-foreground normal-case tracking-normal tabular-nums">
													${DEV_PLAN_PRICES.max}/mo · $
													{getDevPlanAnnualPrice("max")}
													/yr
												</div>
											</th>
										</tr>
									</thead>
									<tbody>
										{usageRows.map((row, idx) => (
											<tr
												key={row.label}
												className={
													idx !== usageRows.length - 1
														? "border-b border-border/60"
														: ""
												}
											>
												<td
													className={`px-5 py-3.5 ${
														row.emphasis
															? "font-semibold text-foreground"
															: "text-foreground/90"
													}`}
												>
													{row.label}
												</td>
												<td className="px-5 py-3.5 text-center">
													<Cell value={row.lite} emphasis={row.emphasis} />
												</td>
												<td className="px-5 py-3.5 text-center bg-muted/20">
													<Cell value={row.pro} emphasis={row.emphasis} />
												</td>
												<td className="px-5 py-3.5 text-center">
													<Cell value={row.max} emphasis={row.emphasis} />
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						</div>

						<p className="mt-4 text-xs text-muted-foreground">
							Usage is metered at each provider&apos;s published per-token rate
							(input, output, and cached tokens). Every request shows its dollar
							value in your dashboard in real time. SoulForge savings vary by
							workload — 50% is typical for multi-turn agent sessions where the
							system prompt and codebase context stay stable.
						</p>
					</div>
				</section>

				<section className="border-t bg-muted/30 py-20 px-4">
					<div className="container mx-auto max-w-3xl">
						<div className="relative overflow-hidden rounded-2xl border bg-card p-8 shadow-sm sm:p-10">
							<div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-foreground/[0.04] blur-2xl" />
							<div className="relative flex flex-col items-start gap-6 sm:flex-row sm:items-center sm:justify-between">
								<div className="flex items-start gap-4">
									<div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-foreground text-background">
										<Calculator className="h-5 w-5" strokeWidth={1.75} />
									</div>
									<div>
										<h3 className="text-lg font-semibold tracking-tight sm:text-xl">
											Not sure which plan fits?
										</h3>
										<p className="mt-1.5 max-w-md text-sm leading-relaxed text-muted-foreground">
											Estimate your monthly cost with the token calculator —
											pick a model, paste a sample prompt, and see what your
											usage actually looks like.
										</p>
									</div>
								</div>
								<CodeCTATracker
									cta="open_token_calculator"
									location="pricing_page"
								>
									<Button asChild size="lg" className="gap-2 shrink-0">
										<a
											href={calculatorUrl}
											target="_blank"
											rel="noopener noreferrer"
										>
											Open calculator
											<ArrowRight className="h-4 w-4" />
										</a>
									</Button>
								</CodeCTATracker>
							</div>
						</div>
					</div>
				</section>

				<Faq />

				<section className="border-t py-20 px-4">
					<div className="container mx-auto max-w-2xl text-center">
						<div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-muted">
							<HelpCircle
								className="h-5 w-5 text-muted-foreground"
								strokeWidth={1.5}
							/>
						</div>
						<h2 className="mb-3 text-3xl font-bold tracking-tight">
							Still deciding?
						</h2>
						<p className="mb-8 text-muted-foreground">
							Start on Pro — most developers ship from there. Switch tiers any
							time, prorated.
						</p>
						<div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
							<CodeCTATracker cta="get_started" location="pricing_bottom_cta">
								<Button size="lg" className="gap-2 px-8" asChild>
									<Link href="/signup?plan=pro">
										Get your DevPass
										<ArrowRight className="h-4 w-4" />
									</Link>
								</Button>
							</CodeCTATracker>
							<Button size="lg" variant="ghost" asChild>
								<a href="mailto:contact@llmgateway.io">Talk to us</a>
							</Button>
						</div>
					</div>
				</section>
			</main>

			<Footer />
		</div>
	);
}
