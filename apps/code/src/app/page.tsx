import { ArrowRight, Sparkles } from "lucide-react";
import Link from "next/link";

import { CodingModelsShowcase } from "@/components/CodingModelsShowcase";
import { Faq } from "@/components/Faq";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import {
	CodeCTATracker,
	LandingPageTracker,
} from "@/components/LandingTracker";
import { PricingPlans } from "@/components/PricingPlans";
import { SoulForgeBoost } from "@/components/SoulForgeBoost";
import { TerminalPreview } from "@/components/TerminalPreview";
import { Button } from "@/components/ui/button";
import { getConfig } from "@/lib/config-server";

import { getDevPlanCreditsLimit } from "@llmgateway/shared";
import {
	AnthropicIcon,
	OpenCodeIcon,
	SoulForgeIcon,
} from "@llmgateway/shared/components";

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
			"Aggressive prompt caching cuts roughly 50% of tokens on multi-turn agent runs. Pair with DevPass to effectively double your monthly usage.",
		setup: "/keys → paste your key",
		highlight: "Saves ~50% tokens",
	},
];

export default function LandingPage() {
	const config = getConfig();
	const credits = {
		lite: getDevPlanCreditsLimit("lite"),
		pro: getDevPlanCreditsLimit("pro"),
		max: getDevPlanCreditsLimit("max"),
	};

	return (
		<div className="min-h-screen bg-background">
			<LandingPageTracker />
			<Header />

			<main>
				{/* Hero */}
				<section className="relative overflow-hidden">
					<div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-muted/60 via-transparent to-transparent" />
					<div className="container relative mx-auto px-4 pt-20 pb-16 sm:pt-28 sm:pb-20">
						<div className="mx-auto max-w-3xl text-center">
							<div className="mb-6 inline-flex items-center gap-2 rounded-full border border-border/60 bg-muted/50 px-4 py-1.5 text-sm text-muted-foreground">
								<Sparkles className="h-3.5 w-3.5" />
								Built for Claude Code · OpenCode · SoulForge
							</div>
							<h1 className="mb-6 text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
								One key. Every model.
								<br />
								<span className="text-muted-foreground">
									Three flat prices.
								</span>
							</h1>
							<p className="mx-auto mb-4 max-w-xl text-lg leading-relaxed text-muted-foreground">
								DevPass turns every dollar you spend into{" "}
								<span className="font-semibold text-foreground">$3</span> of
								model usage at provider rates. Pair it with{" "}
								<span className="font-semibold text-foreground">SoulForge</span>{" "}
								and prompt caching pushes that to roughly{" "}
								<span className="font-semibold text-foreground">$6</span>.
							</p>
							<p className="mx-auto mb-10 max-w-xl text-sm text-muted-foreground">
								Works the same in Claude Code, OpenCode, SoulForge, Cline, and
								every OpenAI-compatible tool — no SDK changes.
							</p>
							<div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
								<CodeCTATracker cta="start_coding" location="hero">
									<Button size="lg" className="gap-2 px-8" asChild>
										<Link href="/signup">
											Get your DevPass
											<ArrowRight className="h-4 w-4" />
										</Link>
									</Button>
								</CodeCTATracker>
								<CodeCTATracker cta="view_plans" location="hero">
									<Button size="lg" variant="outline" asChild>
										<Link href="/pricing">See pricing</Link>
									</Button>
								</CodeCTATracker>
							</div>
						</div>

						<TerminalPreview />
					</div>
				</section>

				{/* Built for these tools */}
				<section className="py-20 px-4">
					<div className="container mx-auto max-w-6xl">
						<div className="mb-14 max-w-2xl">
							<p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
								Native fit
							</p>
							<h2 className="mb-3 text-3xl font-bold tracking-tight sm:text-4xl">
								Drop-in for the agents you already use
							</h2>
							<p className="text-muted-foreground">
								DevPass is built around how Claude Code, OpenCode, and SoulForge
								actually work — not a generic OpenAI-compatible proxy you have
								to glue together.
							</p>
						</div>
						<div className="grid gap-5 md:grid-cols-3">
							{featuredTools.map((tool) => {
								const Icon = tool.icon;
								return (
									<div
										key={tool.name}
										className="relative flex flex-col rounded-2xl border bg-card p-6 transition-all hover:shadow-md"
									>
										<div className="mb-5 flex items-center justify-between">
											<div className="flex h-11 w-11 items-center justify-center rounded-xl bg-foreground text-background">
												<Icon className="h-5 w-5" />
											</div>
											{tool.highlight && (
												<span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
													{tool.highlight}
												</span>
											)}
										</div>
										<h3 className="mb-2 text-lg font-semibold">{tool.name}</h3>
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
						<div className="mt-8 flex items-center justify-center gap-2 text-xs text-muted-foreground">
							<span className="h-px w-12 bg-border" />
							<span>
								+ Cline, Cursor, Aider, Continue & any OpenAI-compatible tool
							</span>
							<span className="h-px w-12 bg-border" />
						</div>
					</div>
				</section>

				{/* SoulForge boost band */}
				<SoulForgeBoost />

				{/* Pricing */}
				<section id="pricing" className="scroll-mt-16 py-20 px-4">
					<div className="container mx-auto max-w-6xl">
						<div className="mb-12 mx-auto max-w-2xl text-center">
							<p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
								Pricing
							</p>
							<h2 className="mb-4 text-3xl font-bold tracking-tight sm:text-4xl">
								What you pay vs. what you get
							</h2>
							<p className="text-muted-foreground">
								Every plan includes the full 200+ model catalog. The only thing
								that changes is the size of your monthly usage allowance.
							</p>
						</div>
						<PricingPlans credits={credits} />
						<div className="mt-8 text-center">
							<Link
								href="/pricing"
								className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
							>
								Compare every feature on the pricing page
								<ArrowRight className="h-3.5 w-3.5" />
							</Link>
						</div>
					</div>
				</section>

				{/* How it works */}
				<section className="bg-muted/30 py-20 px-4">
					<div className="container mx-auto max-w-3xl">
						<div className="mb-14 text-center">
							<h2 className="mb-3 text-3xl font-bold tracking-tight">
								Up and running in minutes
							</h2>
						</div>
						<div className="space-y-8">
							{[
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
										"Two env vars for Claude Code, /providers in OpenCode, /keys in SoulForge. No SDK changes, no code refactor.",
								},
								{
									step: "03",
									title: "Switch models freely",
									description:
										"Claude Opus 4.7 for architecture, GPT-5.5 for review, Gemini 3.1 Pro for fresh eyes — same key, no extra cost.",
								},
							].map((item) => (
								<div key={item.step} className="flex gap-5">
									<div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border bg-card font-mono text-xs font-semibold tabular-nums">
										{item.step}
									</div>
									<div className="pt-1.5">
										<h3 className="font-semibold">{item.title}</h3>
										<p className="mt-1 text-sm leading-relaxed text-muted-foreground">
											{item.description}
										</p>
									</div>
								</div>
							))}
						</div>
					</div>
				</section>

				{/* Models showcase */}
				<section className="py-20 px-4">
					<div className="container mx-auto max-w-6xl">
						<div className="mb-10 max-w-2xl">
							<p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
								The latest flagships
							</p>
							<h2 className="mb-3 text-3xl font-bold tracking-tight sm:text-4xl">
								Every plan ships with the newest models
							</h2>
							<p className="text-muted-foreground">
								Claude Opus 4.7, Gemini 3.1 Pro, GPT-5.5 Pro, plus the strongest
								open-weight Chinese coders — included on every tier.
							</p>
						</div>
						<CodingModelsShowcase uiUrl={config.uiUrl} />
					</div>
				</section>

				{/* FAQ */}
				<Faq />

				{/* Final CTA */}
				<section className="border-t py-20 px-4">
					<div className="container mx-auto max-w-2xl text-center">
						<h2 className="mb-4 text-3xl font-bold tracking-tight">
							Stop watching your token balance
						</h2>
						<p className="mb-8 text-muted-foreground">
							Pick a plan, set two env vars, get back to building.
						</p>
						<div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
							<CodeCTATracker cta="get_started" location="bottom_cta">
								<Button size="lg" className="gap-2 px-8" asChild>
									<Link href="/signup">
										Get your DevPass
										<ArrowRight className="h-4 w-4" />
									</Link>
								</Button>
							</CodeCTATracker>
							<CodeCTATracker cta="browse_models" location="bottom_cta">
								<Button size="lg" variant="ghost" asChild>
									<Link href="/coding-models">Browse all models</Link>
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
