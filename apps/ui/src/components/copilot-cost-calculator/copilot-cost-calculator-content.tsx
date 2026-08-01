import { ChevronDown, Gauge, SlidersHorizontal, Users } from "lucide-react";
import Link from "next/link";

import {
	AGENT_TASK_TOKENS,
	CHAT_SESSION_TOKENS,
	WORKING_DAYS_PER_MONTH,
} from "./calc";
import { COPILOT_CALCULATOR_FAQ } from "./faq-data";

import type { Route } from "next";

const STEPS = [
	{
		icon: Users,
		title: "Describe your team",
		description:
			"Set your headcount, Copilot plan, and how much each developer actually uses chat and agent mode per day. Presets cover light chat through fully agentic workflows.",
	},
	{
		icon: SlidersHorizontal,
		title: "Tune the assumptions",
		description:
			"Pick the model mix, adjust the prompt cache hit rate, and toggle bring-your-own-keys. Every constant in the math is documented below and adjustable.",
	},
	{
		icon: Gauge,
		title: "Compare the two bills",
		description:
			"See the estimated monthly Copilot AI Credits bill next to the same workload at pass-through token prices with caching — and what a hard budget cap means for the worst case.",
	},
];

const ASSUMPTIONS = [
	`A chat session is a ~5-turn conversation totaling ${CHAT_SESSION_TOKENS.input.toLocaleString("en-US")} input and ${CHAT_SESSION_TOKENS.output.toLocaleString("en-US")} output tokens — history is resent every turn, which is why sessions cost more than single prompts.`,
	`An agent task is a multi-step run totaling ${AGENT_TASK_TOKENS.input.toLocaleString("en-US")} input and ${AGENT_TASK_TOKENS.output.toLocaleString("en-US")} output tokens, dominated by repeatedly resent repo context.`,
	`A month is ${WORKING_DAYS_PER_MONTH} working days.`,
	"Both sides are priced from the same token volumes at the same per-million-token rates (premium $5/$25, efficient $0.25/$2, balanced in between), so the comparison isolates structure — seats and included credits versus caching and the platform fee.",
	"Cached input tokens are billed at roughly 10% of the input rate. The cache hit rate slider controls how much of your input traffic is cached; 60% is a conservative default for coding tools.",
	"Copilot's included credits ($15 Pro, $70 Pro+, $200 Max) offset usage; Business and Enterprise allowances vary by agreement, so they're an editable field rather than a guess.",
];

export function CopilotCostCalculatorContent() {
	return (
		<>
			{/* How it works */}
			<section
				className="border-t border-border bg-muted/30 py-20 sm:py-28"
				aria-labelledby="how-it-works-heading"
			>
				<div className="container mx-auto px-4 sm:px-6 lg:px-8">
					<div className="mx-auto max-w-3xl text-center">
						<h2
							id="how-it-works-heading"
							className="text-3xl font-bold tracking-tight text-balance sm:text-4xl"
						>
							How the Copilot cost calculator works
						</h2>
						<p className="mt-4 text-lg text-muted-foreground text-balance leading-relaxed">
							Estimate what GitHub Copilot's usage-based AI Credits cost your
							team each month, then compare the same workload routed through LLM
							Gateway in three steps.
						</p>
					</div>

					<ol className="mx-auto mt-14 grid max-w-5xl gap-6 sm:grid-cols-3">
						{STEPS.map((step, index) => {
							const Icon = step.icon;
							return (
								<li
									key={step.title}
									className="relative rounded-2xl border border-border bg-card/60 p-6"
								>
									<div className="flex items-center gap-3">
										<div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/10 text-blue-500">
											<Icon className="h-5 w-5" />
										</div>
										<span className="font-mono text-sm font-semibold text-muted-foreground">
											Step {index + 1}
										</span>
									</div>
									<h3 className="mt-4 text-lg font-semibold">{step.title}</h3>
									<p className="mt-2 text-sm leading-relaxed text-muted-foreground">
										{step.description}
									</p>
								</li>
							);
						})}
					</ol>
				</div>
			</section>

			{/* Explainer / keyword-rich content */}
			<section className="py-20 sm:py-28" aria-labelledby="explainer-heading">
				<div className="container mx-auto px-4 sm:px-6 lg:px-8">
					<div className="mx-auto max-w-3xl">
						<h2
							id="explainer-heading"
							className="text-3xl font-bold tracking-tight text-balance sm:text-4xl"
						>
							Understanding GitHub Copilot's 2026 pricing
						</h2>
						<div className="mt-6 space-y-5 text-base leading-relaxed text-muted-foreground">
							<p>
								On June 1, 2026, GitHub Copilot moved chat, agent mode, code
								review, and CLI usage from flat-fee plans to metered AI Credits,
								where one credit is $0.01 and cost varies by model. The seat
								price — $10 for Pro, $39 for Pro+, $19 per user for Business,
								$39 per user for Enterprise — is no longer the ceiling on the
								bill; it's the floor. Inline completions are the only feature
								that stayed flat-fee.
							</p>
							<p>
								The economics of coding assistants make this expensive fast.
								Every chat turn resends the conversation so far, and every agent
								step resends system prompts, file trees, and diffs. Token volume
								grows with usage squared, not linearly — which is how a team
								paying $50 a month under flat pricing can project $3,000 under
								metered billing with heavy agent use.
							</p>
							<p>
								The same mechanics are also why routing the workload through a
								gateway is cheaper: all that resent context is exactly what
								prompt caching absorbs, billing repeated input tokens at roughly
								a tenth of the normal rate. Add pass-through provider pricing
								with no per-seat fee, and the structural gap this calculator
								shows emerges — before you even consider routing lighter tasks
								to cheaper models.
							</p>
							<p>
								When the estimate looks right, the{" "}
								<Link
									href={"/migration/github-copilot" as Route}
									className="font-medium text-blue-600 underline-offset-4 hover:underline dark:text-blue-400"
								>
									GitHub Copilot migration guide
								</Link>{" "}
								maps each Copilot workflow to its gateway-backed replacement,
								and the{" "}
								<Link
									href={"/compare/github-copilot" as Route}
									className="font-medium text-blue-600 underline-offset-4 hover:underline dark:text-blue-400"
								>
									full comparison
								</Link>{" "}
								covers features beyond cost.
							</p>
						</div>

						<h3 className="mt-12 text-xl font-semibold">
							Assumptions behind the math
						</h3>
						<ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-relaxed text-muted-foreground">
							{ASSUMPTIONS.map((assumption) => (
								<li key={assumption}>{assumption}</li>
							))}
						</ul>
					</div>
				</div>
			</section>

			{/* FAQ — rendered with native <details> so answers stay in the HTML */}
			<section
				className="border-t border-border bg-muted/30 py-20 sm:py-28"
				aria-labelledby="faq-heading"
			>
				<div className="container mx-auto px-4 sm:px-6 lg:px-8">
					<div className="mx-auto max-w-3xl">
						<div className="text-center">
							<h2
								id="faq-heading"
								className="text-3xl font-bold tracking-tight text-balance sm:text-4xl"
							>
								Frequently asked questions
							</h2>
							<p className="mt-4 text-lg text-muted-foreground text-balance leading-relaxed">
								Everything you need to know about estimating and capping your
								team's AI coding spend.
							</p>
						</div>

						<div className="mt-12 space-y-3">
							{COPILOT_CALCULATOR_FAQ.map((item) => (
								<details
									key={item.question}
									className="group rounded-xl border border-border bg-card/60 px-5 [&_summary::-webkit-details-marker]:hidden"
								>
									<summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-left text-base font-medium">
										{item.question}
										<ChevronDown className="h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180" />
									</summary>
									<p className="pb-5 text-sm leading-relaxed text-muted-foreground">
										{item.answer}
									</p>
								</details>
							))}
						</div>
					</div>
				</div>
			</section>
		</>
	);
}
