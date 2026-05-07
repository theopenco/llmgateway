"use client";

import { ArrowUpRight, Terminal } from "lucide-react";

import { DEV_PLAN_PRICES } from "@llmgateway/shared";

const DEVPASS_URL =
	process.env.NODE_ENV === "development"
		? "http://localhost:3004"
		: "https://devpass.llmgateway.io";

const plans = [
	{ name: "Lite", price: `$${DEV_PLAN_PRICES.lite}` },
	{ name: "Pro", price: `$${DEV_PLAN_PRICES.pro}` },
	{ name: "Max", price: `$${DEV_PLAN_PRICES.max}` },
] as const;

export function DevPassCard() {
	return (
		<a
			href={DEVPASS_URL}
			target="_blank"
			rel="noopener noreferrer"
			className="group relative block overflow-hidden rounded-xl border border-border/60 bg-gradient-to-br from-background via-background to-indigo-500/[0.04] transition-all duration-300 hover:border-indigo-500/40 hover:shadow-[0_0_40px_-12px_rgba(99,102,241,0.25)] dark:to-indigo-400/[0.06]"
		>
			<div className="pointer-events-none absolute inset-y-0 right-0 w-2/3 bg-[radial-gradient(ellipse_at_right,_var(--tw-gradient-stops))] from-indigo-500/[0.06] via-transparent to-transparent dark:from-indigo-400/[0.08]" />
			<div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-indigo-500/[0.08] blur-3xl dark:bg-indigo-400/[0.06]" />

			<div className="relative flex flex-col gap-5 p-5 md:flex-row md:items-center md:justify-between md:gap-8 md:p-6">
				<div className="flex items-start gap-4 md:flex-1">
					<div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-foreground text-background shadow-sm">
						<Terminal className="h-5 w-5" strokeWidth={1.75} />
					</div>
					<div className="min-w-0 flex-1 space-y-2">
						<div className="flex flex-wrap items-center gap-2">
							<h3 className="text-base font-semibold tracking-tight">
								DevPass
							</h3>
							<span className="rounded-full border border-indigo-500/30 bg-indigo-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-indigo-600 dark:text-indigo-300">
								Separate product
							</span>
						</div>
						<p className="text-sm leading-relaxed text-muted-foreground">
							Fixed-price monthly plans for Claude Code, OpenCode, Cursor &
							every coding tool.{" "}
							<span className="font-medium text-foreground">
								$1 turns into $3
							</span>{" "}
							of model usage at provider rates.
						</p>
						<div className="flex flex-wrap items-center gap-1.5 pt-1">
							{plans.map((plan, i) => (
								<span
									key={plan.name}
									className="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-muted/40 px-2 py-1 font-mono text-[11px] tabular-nums text-muted-foreground"
								>
									<span className="font-semibold text-foreground">
										{plan.name}
									</span>
									<span aria-hidden="true" className="text-border">
										·
									</span>
									<span>{plan.price}</span>
									{i < plans.length - 1 && <span className="sr-only">, </span>}
								</span>
							))}
							<span className="ml-1 text-[11px] text-muted-foreground/70">
								/mo · cancel anytime
							</span>
						</div>
					</div>
				</div>

				<div className="flex shrink-0 items-center gap-2 self-start md:self-center">
					<div className="inline-flex items-center gap-1.5 rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background transition-transform duration-300 group-hover:translate-x-0.5">
						Open DevPass
						<ArrowUpRight className="h-4 w-4" />
					</div>
				</div>
			</div>
		</a>
	);
}
