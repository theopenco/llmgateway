import { ArrowRight, ArrowUpRight } from "lucide-react";

import { cn } from "@/lib/utils";

import { MARKETING_STATS } from "@llmgateway/shared";

import { DashboardDemo } from "./dashboard-demo";
import { editorial } from "./fonts";
import styles from "./home.module.css";
import { TrackedLink } from "./tracked-link";

const PROOF = [
	"SOC 2 Type II",
	"SAML SSO and SCIM on Enterprise",
	"Self-host or managed",
	"99.9% SLA on Enterprise Cloud",
];

const STATS = [
	{ value: MARKETING_STATS.tokensRouted, label: "tokens routed" },
	{ value: MARKETING_STATS.requestsRouted, label: "requests routed" },
	{ value: MARKETING_STATS.models, label: "models" },
	{ value: MARKETING_STATS.providers, label: "providers" },
];

const MILESTONES = [
	{
		when: "Week 1",
		title: "Traffic live",
		body: "We move your keys, routing rules and first production traffic with you.",
	},
	{
		when: "Week 2",
		title: "Controls on",
		body: "SSO, audit logs and guardrails set up and checked by your security team.",
	},
	{
		when: "Day 30",
		title: "You decide",
		body: "Missed a milestone? Walk away. No long-term contract before this point.",
	},
];

function PilotPass() {
	return (
		<div className="relative overflow-hidden rounded-3xl border border-[#111113]/10 bg-[#fffdf7] text-[#111113] shadow-[0_40px_100px_-40px_rgba(180,120,20,0.45)] dark:border-amber-300/25 dark:bg-[#0d0d10] dark:text-[#f4f1e8] dark:shadow-[0_40px_120px_-30px_rgba(245,184,61,0.45)]">
			<div aria-hidden className={styles.grain} />
			<div className="relative px-6 pb-6 pt-5 sm:px-7">
				<div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.2em] text-[#111113]/55 dark:text-[#f4f1e8]/55">
					<span className="flex items-center gap-2">
						<span
							className={cn("size-1.5 rounded-full bg-amber-500", styles.lamp)}
						/>
						Boarding pass
					</span>
					<span>Enterprise pilot</span>
				</div>
				<p className="mt-5 font-display text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
					30-day production pilot
				</p>
				<p className="mt-2 text-sm text-[#111113]/60 dark:text-[#f4f1e8]/60">
					Your traffic, your security review, our engineers next to you.
				</p>
				<ol className="mt-6 space-y-4">
					{MILESTONES.map((m) => (
						<li key={m.when} className="grid grid-cols-[4.5rem_1fr] gap-3">
							<span className="pt-0.5 font-mono text-[11px] uppercase tracking-[0.14em] text-amber-700 dark:text-amber-300">
								{m.when}
							</span>
							<span>
								<span className="block text-sm font-semibold">{m.title}</span>
								<span className="block text-[13px] leading-snug text-[#111113]/60 dark:text-[#f4f1e8]/60">
									{m.body}
								</span>
							</span>
						</li>
					))}
				</ol>
			</div>
			<div aria-hidden className="relative h-5">
				<span className="absolute -left-2.5 top-0 size-5 rounded-full border border-[#111113]/10 bg-[#f4f1e8] dark:border-amber-300/25 dark:bg-[#09090b]" />
				<span className="absolute -right-2.5 top-0 size-5 rounded-full border border-[#111113]/10 bg-[#f4f1e8] dark:border-amber-300/25 dark:bg-[#09090b]" />
				<span className="absolute inset-x-4 top-1/2 border-t border-dashed border-[#111113]/15 dark:border-white/15" />
			</div>
			<div className="relative px-6 pb-6 pt-3 sm:px-7">
				<TrackedLink
					href="/enterprise#contact"
					location="home_hero"
					cta="start_pilot"
					className="group flex w-full items-center justify-center gap-2 rounded-full bg-amber-300 px-7 py-4 text-base font-semibold text-[#09090b] shadow-[0_0_0_1px_rgba(180,120,20,0.35),0_18px_40px_-14px_rgba(200,130,20,0.6)] transition-all hover:bg-amber-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#fffdf7] dark:shadow-[0_0_0_1px_rgba(245,184,61,0.4),0_18px_50px_-12px_rgba(245,184,61,0.6)] dark:focus-visible:ring-amber-300 dark:focus-visible:ring-offset-[#0d0d10]"
				>
					Start your 30-day pilot
					<ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
				</TrackedLink>
				<p className="mt-3 text-center text-xs text-[#111113]/55 dark:text-[#f4f1e8]/50">
					Tell us about your stack, then pick a time with our team.
				</p>
			</div>
		</div>
	);
}

export function HomeHero() {
	return (
		<section
			className={cn(
				"relative isolate overflow-hidden bg-[#f4f1e8] text-[#111113] dark:bg-[#09090b] dark:text-[#f4f1e8]",
				styles.hero,
			)}
		>
			<div aria-hidden className={styles.runway} />
			<div
				aria-hidden
				className="absolute -top-48 right-[-12%] -z-10 h-[720px] w-[720px] rounded-full bg-[radial-gradient(circle,rgba(245,184,61,0.26),transparent_65%)]"
			/>
			<div aria-hidden className={styles.grain} />
			<div
				aria-hidden
				className="absolute inset-x-0 bottom-0 -z-10 h-16 bg-gradient-to-b from-transparent to-background"
			/>

			<div className="relative mx-auto max-w-7xl px-4 pb-20 pt-32 sm:px-6 md:pt-40">
				<div className="grid grid-cols-1 gap-10 lg:grid-cols-12 lg:gap-x-14 lg:gap-y-0">
					<div className="min-w-0 lg:col-span-7 lg:row-start-1 lg:self-end">
						<TrackedLink
							href="/blog/soc2-type-ii"
							location="home_hero"
							cta="soc2_announcement"
							className="group inline-flex items-center gap-3 rounded-full border border-amber-700/25 bg-amber-400/[0.12] py-1.5 pl-3 pr-2 font-mono text-[11px] uppercase tracking-[0.16em] text-amber-900 transition-colors hover:border-amber-700/50 dark:border-amber-300/25 dark:bg-amber-300/[0.06] dark:text-amber-200 dark:hover:border-amber-300/50"
						>
							Now SOC 2 Type II compliant
							<span className="flex size-5 items-center justify-center rounded-full bg-amber-500/20 transition-transform group-hover:translate-x-0.5 dark:bg-amber-300/15">
								<ArrowRight className="size-3" />
							</span>
						</TrackedLink>

						<h1 className="mt-7 text-balance font-display text-[40px] font-bold leading-[1.08] tracking-[-0.04em] sm:text-6xl xl:text-[76px]">
							<span className="whitespace-nowrap">Company-wide</span> AI,
							<span
								className={cn(
									editorial.className,
									"mt-[0.06em] block font-normal italic leading-[1.05] tracking-[-0.02em] text-amber-600 dark:text-amber-300",
								)}
							>
								live in weeks, not quarters.
							</span>
						</h1>

						<p className="mt-6 max-w-xl text-lg leading-relaxed text-[#111113]/70 dark:text-[#f4f1e8]/70">
							One OpenAI-compatible gateway to {MARKETING_STATS.models} models
							from {MARKETING_STATS.providers} providers, with retries, failover
							across providers that serve the same model, spend limits and
							per-request costs built in. Enterprise adds SAML SSO, audit logs
							and guardrails, in our cloud or yours.
						</p>
					</div>

					<div
						className={cn(
							"min-w-0 lg:col-span-5 lg:col-start-8 lg:row-span-2 lg:row-start-1 lg:self-center",
							styles.rise,
						)}
						style={{ animationDelay: "120ms" }}
					>
						<PilotPass />
					</div>

					<div className="min-w-0 lg:col-span-7 lg:row-start-2 lg:self-start">
						<ul className="grid max-w-xl lg:mt-7 grid-cols-2 gap-x-6 gap-y-2.5 font-mono text-[11px] uppercase tracking-[0.14em] text-[#111113]/65 dark:text-[#f4f1e8]/60">
							{PROOF.map((item) => (
								<li key={item} className="flex items-center gap-2">
									<span className="size-1 shrink-0 rounded-full bg-amber-500 dark:bg-amber-300" />
									{item}
								</li>
							))}
						</ul>

						<div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-3 border-t border-black/10 pt-6 dark:border-white/10">
							<TrackedLink
								href="/signup"
								auth
								location="home_hero"
								cta="get_api_key"
								className="group inline-flex items-center gap-2 rounded-full border border-black/15 px-5 py-2.5 text-sm font-medium transition-colors hover:border-black/40 hover:bg-black/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:border-white/15 dark:hover:border-white/40 dark:hover:bg-white/[0.04]"
							>
								Get My API Key
								<ArrowUpRight className="size-3.5 opacity-60 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
							</TrackedLink>
							<span className="text-sm text-[#111113]/55 dark:text-[#f4f1e8]/50">
								Just building? Sign up free, no credit card.
							</span>
						</div>
					</div>
				</div>

				<div
					className={cn("mt-16 md:mt-20", styles.rise)}
					style={{ animationDelay: "220ms" }}
				>
					<DashboardDemo />
				</div>

				<dl className="mt-10 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-black/10 bg-black/10 sm:grid-cols-4 dark:border-white/10 dark:bg-white/10">
					{STATS.map((stat) => (
						<div
							key={stat.label}
							className="flex flex-col-reverse bg-[#f4f1e8] px-5 py-4 dark:bg-[#09090b]"
						>
							<dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#111113]/55 dark:text-[#f4f1e8]/45">
								{stat.label}
							</dt>
							<dd className="font-display text-2xl font-bold tracking-tight md:text-3xl">
								{stat.value}
							</dd>
						</div>
					))}
				</dl>
			</div>
		</section>
	);
}
