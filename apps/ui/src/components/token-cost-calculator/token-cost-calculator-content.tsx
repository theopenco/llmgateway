import { ChevronDown, FileText, Route, SlidersHorizontal } from "lucide-react";
import Link from "next/link";

import { CALCULATOR_FAQ } from "./faq-data";

const STEPS = [
	{
		icon: FileText,
		title: "Paste your prompt or document",
		description:
			"Drop in real text, code, or a JSON payload. A BPE tokenizer runs in your browser to count the exact tokens — the same way the model bills you — with nothing uploaded.",
	},
	{
		icon: SlidersHorizontal,
		title: "Set your output size and volume",
		description:
			"Choose how long a response you expect and how many requests you send. Or switch to Estimate mode to enter input and output token volumes directly across multiple models.",
	},
	{
		icon: Route,
		title: "Compare every model and save",
		description:
			"See your prompt ranked across GPT-5, Claude, Gemini, and 280+ models at each provider's cheapest live rate — then route through LLM Gateway to pay it automatically with zero markup.",
	},
];

export function TokenCostCalculatorContent() {
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
							How the LLM cost calculator works
						</h2>
						<p className="mt-4 text-lg text-muted-foreground text-balance leading-relaxed">
							Count the exact tokens in your prompt and price it across every
							major model in three steps, then see how much routing through LLM
							Gateway saves you.
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
							Understanding LLM token costs
						</h2>
						<div className="mt-6 space-y-5 text-base leading-relaxed text-muted-foreground">
							<p>
								Every large language model bills by the token, the small chunks
								of text a model reads and writes. Roughly speaking, one token is
								about four characters of English, so 1,000 tokens is around 750
								words — but the only accurate way to know is to tokenize the
								exact text. This calculator does that in your browser with a
								real BPE tokenizer, so the token counts match how the model
								actually bills you instead of a rough character estimate.
								Providers quote prices per million tokens, and they charge
								separately for the tokens you send (input) and the tokens the
								model generates (output).
							</p>
							<p>
								Output tokens are usually two to four times more expensive than
								input tokens, so the ratio between your prompt size and response
								size has a big impact on your bill. A summarization workload
								that reads a lot and writes a little costs very differently from
								a code-generation workload that writes long responses. The
								calculator above keeps the two separate so your estimate
								reflects how you actually use each model.
							</p>
							<p>
								Prices also vary by provider. A single popular model is often
								hosted by several providers at different rates, and those rates
								change as providers compete on price. Instead of locking
								yourself into one provider, LLM Gateway routes each request to
								the cheapest available provider for that model through one
								OpenAI-compatible API, with no platform markup. That is the gap
								the calculator shows: the official list price versus the lowest
								live price you would actually pay.
							</p>
							<p>
								Use it to budget a new feature, compare GPT-4o against Claude or
								Gemini before you commit, or build the business case for
								switching providers. When the numbers look good, you can{" "}
								<Link
									href="/signup"
									className="font-medium text-blue-600 underline-offset-4 hover:underline dark:text-blue-400"
								>
									start for free
								</Link>{" "}
								and keep the same estimate in production.
							</p>
						</div>
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
								Everything you need to know about estimating and lowering your
								LLM token costs.
							</p>
						</div>

						<div className="mt-12 space-y-3">
							{CALCULATOR_FAQ.map((item) => (
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
