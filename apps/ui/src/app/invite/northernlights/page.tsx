import {
	Activity,
	ArrowRight,
	BarChart3,
	Check,
	Gauge,
	Layers,
	LineChart,
	Lock,
	ShieldCheck,
	Sparkles,
} from "lucide-react";
import Link from "next/link";

import { Button } from "@/lib/components/button";

import type { Metadata } from "next";
import type { Route } from "next";

const TITLE =
	"Northern Lights × LLM Gateway — build on the AI that powers our trading desk";
const DESCRIPTION =
	"Northern Lights runs its trading intelligence on LLM Gateway: one API for 210+ models, automatic failover, and real-time cost analytics. Create your account to build on the same infrastructure.";

// Carry the partner source so signups from this page are attributable; the
// standard LLM Gateway signup/onboarding flow ignores params it doesn't use.
const SIGNUP_HREF =
	"/signup?utm_source=northernlights&utm_medium=invite" as Route;

export const metadata: Metadata = {
	title: TITLE,
	description: DESCRIPTION,
	openGraph: { title: TITLE, description: DESCRIPTION, type: "website" },
	twitter: {
		card: "summary_large_image",
		title: TITLE,
		description: DESCRIPTION,
	},
};

const stats = [
	{ value: "210+", label: "Models, one API" },
	{ value: "25+", label: "Providers unified" },
	{ value: "99.99%", label: "Routed uptime" },
	{ value: "<50ms", label: "Routing overhead" },
];

const features = [
	{
		icon: Layers,
		title: "Every model, one endpoint",
		body: "Access 210+ models from OpenAI, Anthropic, Google and 25+ providers through a single OpenAI-compatible API — the exact stack behind the Northern Lights desk.",
	},
	{
		icon: ShieldCheck,
		title: "Failover that never sleeps",
		body: "Markets don't pause, and neither does your AI. Automatic provider failover keeps signals flowing when an upstream model degrades or goes down.",
	},
	{
		icon: LineChart,
		title: "Cost analytics in real time",
		body: "Track spend, latency and tokens per request. Know the cost of every model call before it shows up on the P&L.",
	},
	{
		icon: Gauge,
		title: "Built for low latency",
		body: "Sub-50ms routing overhead and prompt caching keep time-sensitive strategies fast where every millisecond is edge.",
	},
	{
		icon: Lock,
		title: "Bring your own keys",
		body: "Use your own provider keys and pay zero markup, or top up credits and pay just a 5% platform fee. No lock-in.",
	},
	{
		icon: Activity,
		title: "Guardrails & observability",
		body: "Request-level logging, guardrails and analytics give you the audit trail a trading operation needs.",
	},
];

const steps = [
	{
		title: "Create your account",
		body: "Sign up in seconds with email or GitHub — no credit card required.",
	},
	{
		title: "Add a key or top up",
		body: "Bring your own provider keys or add credits to start routing immediately.",
	},
	{
		title: "Ship on the same stack",
		body: "Point your app at one endpoint and build on the infrastructure that powers Northern Lights.",
	},
];

export default function NorthernLightsInvitePage() {
	return (
		<div className="min-h-screen bg-[#03100c] text-emerald-50 antialiased">
			{/* Co-branded header */}
			<header className="sticky top-0 z-20 border-b border-emerald-400/10 bg-[#03100c]/80 backdrop-blur-md">
				<div className="container mx-auto flex h-16 items-center justify-between px-4">
					<div className="flex items-center gap-3">
						<span className="relative flex h-2.5 w-2.5">
							<span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
							<span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400" />
						</span>
						<span className="font-display text-base font-semibold tracking-tight text-white">
							Northern Lights
						</span>
						<span className="hidden text-emerald-400/40 sm:inline">×</span>
						<span className="hidden text-sm font-medium text-emerald-200/60 sm:inline">
							LLM Gateway
						</span>
					</div>
					<div className="flex items-center gap-2">
						<Button
							asChild
							variant="ghost"
							size="sm"
							className="text-emerald-100/80 hover:bg-emerald-400/10 hover:text-white"
						>
							<Link href="/login">Sign in</Link>
						</Button>
						<Button
							asChild
							size="sm"
							className="bg-emerald-400 font-semibold text-[#03100c] shadow-[0_0_24px_-6px] shadow-emerald-400/50 hover:bg-emerald-300"
						>
							<Link href={SIGNUP_HREF}>Get started</Link>
						</Button>
					</div>
				</div>
			</header>

			{/* Hero */}
			<section className="relative overflow-hidden border-b border-emerald-400/10">
				{/* Aurora glow */}
				<div
					aria-hidden
					className="pointer-events-none absolute inset-0 opacity-70"
				>
					<div className="absolute -top-40 left-1/4 h-[40rem] w-[40rem] -translate-x-1/2 rounded-full bg-emerald-500/20 blur-[120px]" />
					<div className="absolute -top-32 right-1/4 h-[34rem] w-[34rem] translate-x-1/2 rounded-full bg-teal-400/15 blur-[120px]" />
					<div className="absolute top-10 left-1/2 h-[30rem] w-[30rem] -translate-x-1/2 rounded-full bg-cyan-400/10 blur-[120px]" />
				</div>
				<div
					aria-hidden
					className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,transparent_30%,#03100c_75%)]"
				/>

				<div className="container relative mx-auto px-4 py-20 md:py-28 lg:py-32">
					<div className="mx-auto max-w-3xl space-y-8 text-center">
						<span className="inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-4 py-1.5 text-sm font-medium text-emerald-200">
							<Sparkles className="h-3.5 w-3.5 text-emerald-300" />
							Exclusive invite from Northern Lights
						</span>

						<h1 className="font-display text-balance text-4xl font-bold tracking-tight text-white sm:text-5xl md:text-6xl">
							The AI infrastructure behind{" "}
							<span className="bg-gradient-to-r from-emerald-300 via-teal-200 to-cyan-300 bg-clip-text text-transparent">
								Northern Lights
							</span>
						</h1>

						<p className="text-pretty text-base text-emerald-100/70 sm:text-lg md:text-xl">
							Our trading desk runs on LLM Gateway — one API for 210+ models,
							automatic failover, and real-time cost analytics. Create your
							account and build on the same infrastructure that powers Northern
							Lights.
						</p>

						<div className="flex flex-col items-center justify-center gap-4 pt-2 sm:flex-row">
							<Button
								asChild
								size="lg"
								className="group h-12 bg-emerald-400 px-8 text-base font-semibold text-[#03100c] shadow-[0_0_32px_-6px] shadow-emerald-400/60 hover:bg-emerald-300"
							>
								<Link href={SIGNUP_HREF}>
									Create your free account
									<ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
								</Link>
							</Button>
							<span className="text-sm text-emerald-100/50">
								No credit card required
							</span>
						</div>

						{/* Stats */}
						<div className="mx-auto grid max-w-2xl grid-cols-2 gap-px overflow-hidden rounded-2xl border border-emerald-400/15 bg-emerald-400/5 sm:grid-cols-4">
							{stats.map((stat) => (
								<div
									key={stat.label}
									className="bg-[#03100c]/40 px-4 py-5 text-center"
								>
									<div className="font-display text-2xl font-bold text-emerald-300">
										{stat.value}
									</div>
									<div className="mt-1 text-xs text-emerald-100/50">
										{stat.label}
									</div>
								</div>
							))}
						</div>
					</div>
				</div>
			</section>

			{/* Features */}
			<section className="relative">
				<div className="container mx-auto px-4 py-20 md:py-28">
					<div className="mx-auto max-w-2xl text-center">
						<h2 className="font-display text-3xl font-bold tracking-tight text-white sm:text-4xl">
							Trade-grade AI, out of the box
						</h2>
						<p className="mt-4 text-pretty text-emerald-100/60">
							Everything Northern Lights relies on to keep its models fast,
							reliable, and accountable — available to you the moment you sign
							up.
						</p>
					</div>

					<div className="mx-auto mt-14 grid max-w-5xl gap-5 sm:grid-cols-2 lg:grid-cols-3">
						{features.map((feature) => (
							<div
								key={feature.title}
								className="group rounded-2xl border border-emerald-400/12 bg-gradient-to-b from-emerald-400/[0.06] to-transparent p-6 transition-colors hover:border-emerald-400/30"
							>
								<div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-400/10 text-emerald-300 ring-1 ring-emerald-400/20">
									<feature.icon className="h-5 w-5" />
								</div>
								<h3 className="mt-5 font-display text-lg font-semibold text-white">
									{feature.title}
								</h3>
								<p className="mt-2 text-sm leading-relaxed text-emerald-100/60">
									{feature.body}
								</p>
							</div>
						))}
					</div>
				</div>
			</section>

			{/* How it works */}
			<section className="relative border-y border-emerald-400/10 bg-emerald-400/[0.03]">
				<div className="container mx-auto px-4 py-20 md:py-28">
					<div className="mx-auto max-w-2xl text-center">
						<h2 className="font-display text-3xl font-bold tracking-tight text-white sm:text-4xl">
							Live in three steps
						</h2>
						<p className="mt-4 text-emerald-100/60">
							From invite to production on the standard LLM Gateway onboarding
							flow.
						</p>
					</div>

					<div className="mx-auto mt-14 grid max-w-4xl gap-6 md:grid-cols-3">
						{steps.map((step, i) => (
							<div key={step.title} className="relative">
								<div className="flex h-10 w-10 items-center justify-center rounded-full border border-emerald-400/30 bg-emerald-400/10 font-display text-sm font-bold text-emerald-300">
									{i + 1}
								</div>
								<h3 className="mt-5 font-display text-lg font-semibold text-white">
									{step.title}
								</h3>
								<p className="mt-2 text-sm leading-relaxed text-emerald-100/60">
									{step.body}
								</p>
							</div>
						))}
					</div>
				</div>
			</section>

			{/* Final CTA */}
			<section className="relative overflow-hidden">
				<div
					aria-hidden
					className="pointer-events-none absolute inset-0 opacity-60"
				>
					<div className="absolute bottom-0 left-1/2 h-[26rem] w-[44rem] -translate-x-1/2 translate-y-1/3 rounded-full bg-emerald-500/20 blur-[120px]" />
				</div>
				<div className="container relative mx-auto px-4 py-20 md:py-28">
					<div className="mx-auto max-w-2xl space-y-8 text-center">
						<div className="space-y-4">
							<h2 className="font-display text-3xl font-bold tracking-tight text-white sm:text-4xl">
								Build on the same edge as Northern Lights
							</h2>
							<ul className="mx-auto inline-flex flex-col gap-3 text-left">
								{[
									"210+ models through one OpenAI-compatible API",
									"Automatic failover and prompt caching",
									"Just a 5% platform fee — or bring your own keys",
								].map((item) => (
									<li key={item} className="flex items-start gap-3">
										<span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-400/15">
											<Check className="h-3 w-3 text-emerald-300" />
										</span>
										<span className="text-sm text-emerald-100/70">{item}</span>
									</li>
								))}
							</ul>
						</div>

						<div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
							<Button
								asChild
								size="lg"
								className="group h-12 bg-emerald-400 px-8 text-base font-semibold text-[#03100c] shadow-[0_0_32px_-6px] shadow-emerald-400/60 hover:bg-emerald-300"
							>
								<Link href={SIGNUP_HREF}>
									Get started free
									<ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
								</Link>
							</Button>
							<Button
								asChild
								size="lg"
								variant="outline"
								className="h-12 border-emerald-400/30 bg-transparent px-8 text-base font-medium text-emerald-100 hover:bg-emerald-400/10 hover:text-white"
							>
								<Link href="/login">Sign in</Link>
							</Button>
						</div>
					</div>
				</div>
			</section>

			{/* Slim footer */}
			<footer className="border-t border-emerald-400/10">
				<div className="container mx-auto flex flex-col items-center justify-between gap-4 px-4 py-8 text-sm text-emerald-100/50 sm:flex-row">
					<div className="flex items-center gap-2">
						<BarChart3 className="h-4 w-4 text-emerald-400/70" />
						<span>
							Northern Lights LLC — powered by{" "}
							<Link
								href={"/" as Route}
								className="text-emerald-300 underline-offset-4 hover:underline"
							>
								LLM Gateway
							</Link>
						</span>
					</div>
					<div className="flex items-center gap-6">
						<Link
							href="/legal/privacy"
							className="hover:text-emerald-100"
							prefetch={false}
						>
							Privacy
						</Link>
						<Link
							href="/legal/terms"
							className="hover:text-emerald-100"
							prefetch={false}
						>
							Terms
						</Link>
					</div>
				</div>
			</footer>
		</div>
	);
}
