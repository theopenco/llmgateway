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
		"Flat-rate AI coding plans. Lite, Pro, and Max — every plan includes 200+ models. Pick the monthly usage that matches your workflow.",
	openGraph: {
		title: "Pricing — DevPass",
		description:
			"Flat-rate AI coding plans. Every plan includes 200+ models — Claude, GPT-5, Gemini, and more.",
	},
};

interface UsageRow {
	label: string;
	lite: string | boolean;
	pro: string | boolean;
	max: string | boolean;
}

function formatUsd(amount: number): string {
	return Number.isInteger(amount)
		? `$${amount}`
		: `$${amount.toFixed(2).replace(/\.?0+$/, "")}`;
}

function formatMultiplier(multiplier: number): string {
	const rounded = Math.round(multiplier * 10) / 10;
	return Number.isInteger(rounded) ? `~${rounded}×` : `~${rounded.toFixed(1)}×`;
}

const liteCredits = getDevPlanCreditsLimit("lite");
const proCredits = getDevPlanCreditsLimit("pro");
const maxCredits = getDevPlanCreditsLimit("max");
const liteMultiplier = formatMultiplier(liteCredits / DEV_PLAN_PRICES.lite);
const proMultiplier = formatMultiplier(proCredits / DEV_PLAN_PRICES.pro);
const maxMultiplier = formatMultiplier(maxCredits / DEV_PLAN_PRICES.max);

const usageRows: UsageRow[] = [
	{
		label: "Monthly model usage allowance",
		lite: formatUsd(liteCredits),
		pro: formatUsd(proCredits),
		max: formatUsd(maxCredits),
	},
	{
		label: "Approx. effective discount vs. providers",
		lite: liteMultiplier,
		pro: proMultiplier,
		max: maxMultiplier,
	},
	{
		label: "Models included",
		lite: "200+",
		pro: "200+",
		max: "200+",
	},
	{
		label: "Claude, GPT-5, Gemini, Llama, Qwen, …",
		lite: true,
		pro: true,
		max: true,
	},
	{
		label: "Use any OpenAI/Anthropic-compatible tool",
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
		label: "All-day agent runs",
		lite: false,
		pro: false,
		max: true,
	},
];

function Cell({ value }: { value: string | boolean }) {
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
		<span className="text-sm font-medium text-foreground tabular-nums">
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
								Plans &amp; pricing
							</div>
							<h1 className="mb-5 text-4xl font-bold tracking-tight sm:text-5xl">
								Flat rate. Every model.
								<br />
								No token math.
							</h1>
							<p className="mx-auto max-w-xl text-lg leading-relaxed text-muted-foreground">
								One subscription, 200+ models, predictable monthly usage. Save{" "}
								{DEV_PLAN_ANNUAL_DISCOUNT_MONTHS} months when you bill annually.
							</p>
						</div>
					</div>
				</section>

				<section id="plans" className="scroll-mt-20 py-12 px-4">
					<div className="container mx-auto max-w-5xl">
						<PricingPlans />
					</div>
				</section>

				<section className="bg-muted/30 py-20 px-4">
					<div className="container mx-auto max-w-5xl">
						<div className="mb-12 max-w-2xl">
							<p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground mb-3">
								Usage &amp; features
							</p>
							<h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
								What&apos;s in each plan
							</h2>
							<p className="mt-3 text-muted-foreground">
								Every tier ships with the full model catalog. The only thing
								that changes is how much usage you have to play with each month.
							</p>
						</div>

						<div className="overflow-hidden rounded-xl border bg-card shadow-sm">
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
												<td className="px-5 py-3.5 text-foreground/90">
													{row.label}
												</td>
												<td className="px-5 py-3.5 text-center">
													<Cell value={row.lite} />
												</td>
												<td className="px-5 py-3.5 text-center bg-muted/20">
													<Cell value={row.pro} />
												</td>
												<td className="px-5 py-3.5 text-center">
													<Cell value={row.max} />
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
							value in your dashboard in real time.
						</p>
					</div>
				</section>

				<section className="py-20 px-4">
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
