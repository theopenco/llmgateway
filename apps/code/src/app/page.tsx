import {
	ArrowRight,
	Check,
	Code,
	Layers,
	RotateCcw,
	Sparkles,
	Terminal,
	Zap,
} from "lucide-react";
import Link from "next/link";

import { CodingModelsShowcase } from "@/components/CodingModelsShowcase";
import { Button } from "@/components/ui/button";
import { getConfig } from "@/lib/config-server";

import {
	AnthropicIcon,
	ClineIcon,
	CursorIcon,
} from "@llmgateway/shared/components";

const plans = [
	{
		name: "Lite",
		price: 29,
		usage: 87,
		description: "For occasional AI-assisted coding",
		features: [
			"$87 in model usage",
			"All 200+ models included",
			"Usage resets monthly",
		],
		tier: "lite",
	},
	{
		name: "Pro",
		price: 79,
		usage: 237,
		description: "For daily development workflows",
		features: [
			"$237 in model usage",
			"All 200+ models included",
			"Usage resets monthly",
			"Best value for developers",
		],
		tier: "pro",
		popular: true,
	},
	{
		name: "Max",
		price: 179,
		usage: 537,
		description: "For power users and heavy sessions",
		features: [
			"$537 in model usage",
			"All 200+ models included",
			"Usage resets monthly",
			"Maximum throughput",
		],
		tier: "max",
	},
];

const tools = [
	{ name: "Claude Code", icon: AnthropicIcon },
	{ name: "Cursor", icon: CursorIcon },
	{ name: "Cline", icon: ClineIcon },
];

export default function LandingPage() {
	const config = getConfig();

	return (
		<div className="min-h-screen bg-background">
			{/* Header */}
			<header className="border-b border-border/50">
				<div className="container mx-auto px-4 py-4 flex items-center justify-between">
					<Link href="/" className="flex items-center gap-2">
						<Code className="h-6 w-6" />
						<span className="font-semibold text-lg">LLM Gateway Code</span>
					</Link>
					<div className="flex items-center gap-3">
						<Button variant="ghost" size="sm" asChild>
							<Link href="/coding-models">Models</Link>
						</Button>
						<Button variant="ghost" size="sm" asChild>
							<Link href="/login">Sign in</Link>
						</Button>
						<Button size="sm" asChild>
							<Link href="/signup">Get Started</Link>
						</Button>
					</div>
				</div>
			</header>

			<main>
				{/* Hero */}
				<section className="relative overflow-hidden">
					<div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-muted/60 via-transparent to-transparent" />
					<div className="container relative mx-auto px-4 pt-20 pb-16 sm:pt-28 sm:pb-20">
						<div className="mx-auto max-w-3xl text-center">
							<div className="mb-6 inline-flex items-center gap-2 rounded-full border border-border/60 bg-muted/50 px-4 py-1.5 text-sm text-muted-foreground">
								<Sparkles className="h-3.5 w-3.5" />
								Pay once, get 3x the value in usage
							</div>
							<h1 className="mb-6 text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
								One subscription.
								<br />
								Every coding model.
							</h1>
							<p className="mx-auto mb-10 max-w-xl text-lg leading-relaxed text-muted-foreground">
								Fixed-price dev plans for Claude Code, Cursor, Cline, and any
								OpenAI-compatible tool. Stop juggling API keys and balances.
							</p>
							<div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
								<Button size="lg" className="gap-2 px-8" asChild>
									<Link href="/signup">
										Start coding
										<ArrowRight className="h-4 w-4" />
									</Link>
								</Button>
								<Button size="lg" variant="outline" asChild>
									<Link href="#pricing">View plans</Link>
								</Button>
							</div>
						</div>

						{/* Terminal preview */}
						<div className="mx-auto mt-16 max-w-2xl">
							<div className="overflow-hidden rounded-xl border border-border/60 bg-card shadow-lg">
								<div className="flex items-center gap-2 border-b border-border/40 px-4 py-3">
									<div className="flex gap-1.5">
										<div className="h-3 w-3 rounded-full bg-muted-foreground/20" />
										<div className="h-3 w-3 rounded-full bg-muted-foreground/20" />
										<div className="h-3 w-3 rounded-full bg-muted-foreground/20" />
									</div>
									<span className="ml-2 text-xs text-muted-foreground font-mono">
										terminal
									</span>
								</div>
								<div className="p-5 font-mono text-sm leading-relaxed">
									<div className="text-muted-foreground">
										<span className="text-foreground/70">$</span> export
										ANTHROPIC_BASE_URL=
										<span className="text-foreground">
											https://api.llmgateway.io
										</span>
									</div>
									<div className="mt-1 text-muted-foreground">
										<span className="text-foreground/70">$</span> export
										ANTHROPIC_AUTH_TOKEN=
										<span className="text-foreground">llmgtwy_your_key</span>
									</div>
									<div className="mt-1 text-muted-foreground">
										<span className="text-foreground/70">$</span> claude
									</div>
									<div className="mt-3 text-muted-foreground/60">
										# works with any model — switch freely
									</div>
									<div className="mt-1 text-muted-foreground">
										<span className="text-foreground/70">$</span> export
										ANTHROPIC_MODEL=
										<span className="text-foreground">gpt-5</span>
									</div>
								</div>
							</div>
						</div>
					</div>
				</section>

				{/* Compatible tools */}
				<section className="border-y border-border/40 bg-muted/30 py-10">
					<div className="container mx-auto px-4">
						<div className="flex flex-col items-center gap-6 sm:flex-row sm:justify-center sm:gap-12">
							<span className="text-sm text-muted-foreground">Works with</span>
							<div className="flex items-center gap-8 sm:gap-10">
								{tools.map((tool) => (
									<div
										key={tool.name}
										className="flex items-center gap-2.5 text-muted-foreground"
									>
										<tool.icon className="h-5 w-5" />
										<span className="text-sm font-medium">{tool.name}</span>
									</div>
								))}
								<span className="text-sm text-muted-foreground">
									+ any OpenAI-compatible tool
								</span>
							</div>
						</div>
					</div>
				</section>

				{/* Value props */}
				<section className="py-20 px-4">
					<div className="container mx-auto max-w-5xl">
						<div className="mb-14 text-center">
							<h2 className="mb-3 text-3xl font-bold tracking-tight">
								Why developers switch to Dev Plans
							</h2>
							<p className="text-muted-foreground">
								Stop paying per token. Start shipping.
							</p>
						</div>
						<div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
							<div className="rounded-xl border p-6 transition-colors hover:bg-muted/30">
								<div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-foreground text-background">
									<Zap className="h-5 w-5" strokeWidth={1.5} />
								</div>
								<h3 className="mb-2 font-semibold">3x your money</h3>
								<p className="text-sm leading-relaxed text-muted-foreground">
									Every dollar you pay unlocks $3 in model usage. A $29 plan
									gives you $87 worth of API calls.
								</p>
							</div>
							<div className="rounded-xl border p-6 transition-colors hover:bg-muted/30">
								<div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-foreground text-background">
									<Layers className="h-5 w-5" strokeWidth={1.5} />
								</div>
								<h3 className="mb-2 font-semibold">200+ models, one key</h3>
								<p className="text-sm leading-relaxed text-muted-foreground">
									Claude, GPT-5, Gemini, Llama, Qwen, and every major model.
									Switch between them with an env var.
								</p>
							</div>
							<div className="rounded-xl border p-6 transition-colors hover:bg-muted/30">
								<div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-foreground text-background">
									<RotateCcw className="h-5 w-5" strokeWidth={1.5} />
								</div>
								<h3 className="mb-2 font-semibold">Resets every month</h3>
								<p className="text-sm leading-relaxed text-muted-foreground">
									Your usage allowance refreshes automatically. No rollover
									anxiety, no manual top-ups.
								</p>
							</div>
							<div className="rounded-xl border p-6 transition-colors hover:bg-muted/30">
								<div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-foreground text-background">
									<Terminal className="h-5 w-5" strokeWidth={1.5} />
								</div>
								<h3 className="mb-2 font-semibold">2-minute setup</h3>
								<p className="text-sm leading-relaxed text-muted-foreground">
									Set two environment variables and you&apos;re in. No SDK
									changes, no code refactoring.
								</p>
							</div>
							<div className="rounded-xl border p-6 transition-colors hover:bg-muted/30">
								<div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-foreground text-background">
									<svg
										className="h-5 w-5"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										strokeWidth={1.5}
										strokeLinecap="round"
										strokeLinejoin="round"
									>
										<path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
									</svg>
								</div>
								<h3 className="mb-2 font-semibold">Predictable billing</h3>
								<p className="text-sm leading-relaxed text-muted-foreground">
									One fixed monthly price. No surprise invoices, no per-token
									math. Budget with confidence.
								</p>
							</div>
							<div className="rounded-xl border p-6 transition-colors hover:bg-muted/30">
								<div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-foreground text-background">
									<Sparkles className="h-5 w-5" strokeWidth={1.5} />
								</div>
								<h3 className="mb-2 font-semibold">Upgrade anytime</h3>
								<p className="text-sm leading-relaxed text-muted-foreground">
									Move between Lite, Pro, and Max as your needs change. No
									lock-in, cancel anytime.
								</p>
							</div>
						</div>
					</div>
				</section>

				{/* Pricing */}
				<section id="pricing" className="scroll-mt-16 bg-muted/30 py-20 px-4">
					<div className="container mx-auto max-w-5xl">
						<div className="mb-14 text-center">
							<h2 className="mb-3 text-3xl font-bold tracking-tight">
								Simple, transparent pricing
							</h2>
							<p className="text-muted-foreground">
								All plans include every model. Pick the usage level that fits
								your workflow.
							</p>
						</div>
						<div className="grid gap-6 md:grid-cols-3">
							{plans.map((plan) => (
								<div
									key={plan.tier}
									className={`relative flex flex-col rounded-xl border bg-card p-7 transition-shadow ${
										plan.popular
											? "border-foreground/20 shadow-lg ring-1 ring-foreground/5"
											: "hover:shadow-md"
									}`}
								>
									{plan.popular && (
										<div className="absolute -top-3 left-6">
											<span className="rounded-full bg-foreground px-3 py-1 text-xs font-medium text-background">
												Most popular
											</span>
										</div>
									)}
									<div className="mb-6">
										<h3 className="text-lg font-semibold">{plan.name}</h3>
										<p className="mt-1 text-sm text-muted-foreground">
											{plan.description}
										</p>
									</div>
									<div className="mb-1 flex items-baseline gap-1">
										<span className="text-4xl font-bold">${plan.price}</span>
										<span className="text-muted-foreground">/mo</span>
									</div>
									<div className="mb-6 flex items-center gap-1.5 text-sm">
										<ArrowRight className="h-3 w-3 text-muted-foreground" />
										<span className="font-medium">${plan.usage}</span>
										<span className="text-muted-foreground">in usage</span>
									</div>
									<ul className="mb-8 flex-1 space-y-3">
										{plan.features.map((feature) => (
											<li key={feature} className="flex items-start gap-2.5">
												<Check className="mt-0.5 h-4 w-4 shrink-0 text-foreground/70" />
												<span className="text-sm text-muted-foreground">
													{feature}
												</span>
											</li>
										))}
									</ul>
									<Button
										className="w-full"
										variant={plan.popular ? "default" : "outline"}
										asChild
									>
										<Link href={`/signup?plan=${plan.tier}`}>Get started</Link>
									</Button>
								</div>
							))}
						</div>
					</div>
				</section>

				{/* How it works */}
				<section className="py-20 px-4">
					<div className="container mx-auto max-w-3xl">
						<div className="mb-14 text-center">
							<h2 className="mb-3 text-3xl font-bold tracking-tight">
								Up and running in minutes
							</h2>
						</div>
						<div className="space-y-8">
							{[
								{
									step: "1",
									title: "Pick a plan",
									description:
										"Choose Lite, Pro, or Max. You get an API key immediately after subscribing.",
								},
								{
									step: "2",
									title: "Set your env vars",
									description:
										"Point your tool's base URL to api.llmgateway.io and paste your key. Two lines, done.",
								},
								{
									step: "3",
									title: "Code with any model",
									description:
										"Use Claude for architecture, GPT-5 for a second opinion, Gemini for speed — switch anytime.",
								},
							].map((item) => (
								<div key={item.step} className="flex gap-5">
									<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border bg-card text-sm font-semibold">
										{item.step}
									</div>
									<div className="pt-1">
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
				<section className="bg-muted/30 py-20 px-4">
					<div className="container mx-auto max-w-6xl">
						<div className="mb-10 text-center">
							<h2 className="mb-3 text-3xl font-bold tracking-tight">
								Top coding models
							</h2>
							<p className="text-muted-foreground">
								All included with every plan — use whichever fits the task.
							</p>
						</div>
						<CodingModelsShowcase uiUrl={config.uiUrl} />
					</div>
				</section>

				{/* Final CTA */}
				<section className="py-20 px-4">
					<div className="container mx-auto max-w-2xl text-center">
						<h2 className="mb-4 text-3xl font-bold tracking-tight">
							Stop watching your token balance
						</h2>
						<p className="mb-8 text-muted-foreground">
							Pick a plan, set two env vars, and get back to building.
						</p>
						<div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
							<Button size="lg" className="gap-2 px-8" asChild>
								<Link href="/signup">
									Get started
									<ArrowRight className="h-4 w-4" />
								</Link>
							</Button>
							<Button size="lg" variant="ghost" asChild>
								<Link href="/coding-models">Browse models</Link>
							</Button>
						</div>
					</div>
				</section>
			</main>

			{/* Footer */}
			<footer className="border-t py-8 px-4">
				<div className="container mx-auto flex flex-col items-center justify-between gap-4 md:flex-row">
					<Link href="/" className="flex items-center gap-2">
						<Code className="h-5 w-5" />
						<span className="font-medium">LLM Gateway Code</span>
					</Link>
					<div className="flex items-center gap-6 text-sm text-muted-foreground">
						<Link
							href="/coding-models"
							className="hover:text-foreground transition-colors"
						>
							Models
						</Link>
						<a
							href="https://docs.llmgateway.io"
							target="_blank"
							rel="noopener noreferrer"
							className="hover:text-foreground transition-colors"
						>
							Docs
						</a>
						<a
							href="https://llmgateway.io/discord"
							target="_blank"
							rel="noopener noreferrer"
							className="hover:text-foreground transition-colors"
						>
							Discord
						</a>
					</div>
					<p className="text-sm text-muted-foreground">
						&copy; {new Date().getFullYear()} LLM Gateway
					</p>
				</div>
			</footer>
		</div>
	);
}
