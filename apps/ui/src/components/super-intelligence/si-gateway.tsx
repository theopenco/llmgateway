import {
	ArrowRight,
	BarChart3,
	KeyRound,
	Network,
	RefreshCw,
	ShieldCheck,
	Sparkles,
} from "lucide-react";

import { TrackedLink } from "@/components/home/tracked-link";

import { MARKETING_STATS } from "@llmgateway/shared";

import { CopySnippet } from "./tracking";

const SNIPPET = `curl https://api.llmgateway.io/v1/chat/completions \\
  -H "Authorization: Bearer $LLM_GATEWAY_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "auto",
    "messages": [{ "role": "user", "content": "Hello, SI" }]
  }'`;

const FEATURES = [
	{
		icon: Network,
		title: "Every SI model, one endpoint",
		body: `${MARKETING_STATS.models} models from ${MARKETING_STATS.providers} providers behind one OpenAI-compatible API.`,
	},
	{
		icon: RefreshCw,
		title: "Automatic failover",
		body: "When a provider degrades, requests route to a healthy one before your users notice.",
	},
	{
		icon: Sparkles,
		title: "Smart routing",
		body: "Send model: auto and let the gateway pick a model for each request, or pin any model by ID.",
	},
	{
		icon: BarChart3,
		title: "Cost and usage in one place",
		body: "Tokens, latency and spend per request, per project and per key, ready for any SI usage report.",
	},
	{
		icon: KeyRound,
		title: "One key, one bill",
		body: "Stop juggling provider accounts. Use credits or bring your own provider keys.",
	},
	{
		icon: ShieldCheck,
		title: "Enterprise controls",
		body: "SSO, audit logs, guardrails and data retention controls for regulated and government teams.",
	},
];

const STATS = [
	{ value: MARKETING_STATS.models, label: "SI models" },
	{ value: MARKETING_STATS.providers, label: "Providers" },
	{ value: MARKETING_STATS.tokensRouted, label: "Tokens routed" },
	{ value: MARKETING_STATS.effectiveUptime, label: "Effective uptime" },
];

export function SiGatewayHero() {
	return (
		<section className="relative overflow-hidden pt-32 pb-16 sm:pt-40 sm:pb-24">
			<div
				aria-hidden
				className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[640px] bg-[radial-gradient(60%_50%_at_50%_0%,rgba(56,189,248,0.18),transparent_70%),radial-gradient(40%_40%_at_85%_20%,rgba(139,92,246,0.16),transparent_70%)]"
			/>
			<div className="container mx-auto px-4 sm:px-6 lg:px-8">
				<div className="mx-auto max-w-4xl text-center">
					<TrackedLink
						href="/super-intelligence"
						location="si_gateway_hero"
						cta="eo_badge"
						className="mb-6 inline-flex items-center gap-2 rounded-full border border-sky-500/30 bg-sky-500/10 px-4 py-1.5 transition-colors hover:border-sky-500/60"
					>
						<span className="font-mono text-xs text-sky-600 dark:text-sky-400">
							EO 14434
						</span>
						<span className="text-xs text-muted-foreground">
							AI is now SI. Here is what that means
						</span>
						<ArrowRight className="h-3 w-3 text-muted-foreground" />
					</TrackedLink>
					<h1 className="mb-6 text-4xl font-bold tracking-tight text-balance sm:text-6xl lg:text-7xl">
						The SI Gateway for every{" "}
						<span className="bg-gradient-to-r from-sky-400 via-violet-400 to-emerald-400 bg-clip-text text-transparent">
							Super Intelligence
						</span>{" "}
						model
					</h1>
					<p className="mx-auto mb-10 max-w-2xl text-lg leading-relaxed text-balance text-muted-foreground sm:text-xl">
						One API key for {MARKETING_STATS.models} models across{" "}
						{MARKETING_STATS.providers} providers, with routing, failover, cost
						tracking and logs built in.
					</p>
					<div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
						<TrackedLink
							href="/signup"
							location="si_gateway_hero"
							cta="get_started"
							auth
							className="inline-flex h-11 w-full items-center justify-center rounded-md bg-primary px-8 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 sm:w-auto"
						>
							Start with SI Gateway
							<ArrowRight className="ml-2 h-4 w-4" />
						</TrackedLink>
						<TrackedLink
							href="https://docs.llmgateway.io"
							location="si_gateway_hero"
							cta="read_docs"
							external
							className="inline-flex h-11 w-full items-center justify-center rounded-md border border-border px-8 text-sm font-medium transition-colors hover:bg-muted sm:w-auto"
						>
							Read the docs
						</TrackedLink>
					</div>
				</div>
				<div className="mx-auto mt-14 max-w-3xl">
					<CopySnippet code={SNIPPET} location="si_gateway_hero" />
					<p className="mt-3 text-center text-sm text-muted-foreground">
						OpenAI-compatible. Change the base URL and key, keep your code.
					</p>
				</div>
			</div>
		</section>
	);
}

export function SiGatewayStats() {
	return (
		<section className="py-12">
			<div className="container mx-auto px-4 sm:px-6 lg:px-8">
				<div className="mx-auto grid max-w-5xl grid-cols-2 gap-4 lg:grid-cols-4 lg:gap-6">
					{STATS.map((stat) => (
						<div
							key={stat.label}
							className="flex flex-col items-center rounded-2xl border border-border bg-card/50 p-6"
						>
							<span className="text-2xl font-bold text-primary sm:text-3xl">
								{stat.value}
							</span>
							<span className="mt-2 text-sm font-medium text-muted-foreground">
								{stat.label}
							</span>
						</div>
					))}
				</div>
			</div>
		</section>
	);
}

export function SiGatewayFeatures() {
	return (
		<section className="py-20 sm:py-28">
			<div className="container mx-auto px-4 sm:px-6 lg:px-8">
				<div className="mx-auto max-w-6xl">
					<div className="mb-12 text-center sm:mb-16">
						<h2 className="mb-4 text-3xl font-bold tracking-tight text-balance sm:text-4xl lg:text-5xl">
							Everything between your app and SI providers
						</h2>
						<p className="mx-auto max-w-2xl text-lg leading-relaxed text-balance text-muted-foreground">
							An SI gateway handles the parts every team rebuilds: keys,
							routing, retries, spend and logs.
						</p>
					</div>
					<div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
						{FEATURES.map((feature) => (
							<div
								key={feature.title}
								className="rounded-xl border border-border bg-card p-6 transition-colors hover:border-primary/50"
							>
								<div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
									<feature.icon className="h-5 w-5" />
								</div>
								<h3 className="mb-2 text-lg font-semibold">{feature.title}</h3>
								<p className="text-sm leading-relaxed text-muted-foreground">
									{feature.body}
								</p>
							</div>
						))}
					</div>
				</div>
			</div>
		</section>
	);
}

interface SiCtaProps {
	location: string;
	title: string;
	body: string;
}

export function SiCta({ location, title, body }: SiCtaProps) {
	return (
		<section className="py-20 sm:py-28">
			<div className="container mx-auto px-4 sm:px-6 lg:px-8">
				<div className="mx-auto max-w-4xl overflow-hidden rounded-2xl border border-sky-500/20 bg-gradient-to-br from-sky-500/[0.06] via-violet-500/[0.03] to-transparent p-8 text-center sm:p-12">
					<h2 className="mb-4 text-3xl font-bold tracking-tight text-balance sm:text-4xl">
						{title}
					</h2>
					<p className="mx-auto mb-8 max-w-2xl text-base leading-relaxed text-balance text-muted-foreground sm:text-lg">
						{body}
					</p>
					<div className="flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4">
						<TrackedLink
							href="/signup"
							location={location}
							cta="get_started"
							auth
							className="inline-flex h-11 w-full items-center justify-center rounded-md bg-primary px-8 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 sm:w-auto"
						>
							Get started free
							<ArrowRight className="ml-2 h-4 w-4" />
						</TrackedLink>
						<TrackedLink
							href="/enterprise#contact"
							location={location}
							cta="talk_to_sales"
							className="inline-flex h-11 w-full items-center justify-center rounded-md border border-border px-8 text-sm font-medium transition-colors hover:bg-muted sm:w-auto"
						>
							Talk to sales
						</TrackedLink>
					</div>
				</div>
			</div>
		</section>
	);
}
