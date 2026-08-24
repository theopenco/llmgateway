"use client";

import { motion } from "motion/react";

import { cn } from "@/lib/utils";

import type { GameState } from "@llmgateway/shared/sandbox-escape";

export function formatCredits(amount: number): string {
	if (amount <= 0) {
		return "$0.0000";
	}
	if (amount < 0.0001) {
		return "<$0.0001";
	}
	return `$${amount.toFixed(4)}`;
}

function Stat({
	label,
	value,
	tone = "default",
	hint,
}: {
	label: string;
	value: string;
	tone?: "default" | "amber" | "rose" | "cyan";
	hint?: string;
}) {
	return (
		<div className="flex flex-col gap-1">
			<span className="font-mono text-[9px] tracking-[0.18em] text-emerald-500/50 uppercase">
				{label}
			</span>
			<span
				className={cn(
					"font-mono text-base leading-none font-semibold tabular-nums",
					tone === "amber" && "text-amber-300",
					tone === "rose" && "text-rose-300",
					tone === "cyan" && "text-cyan-300",
					tone === "default" && "text-emerald-200",
				)}
			>
				{value}
			</span>
			{hint ? (
				<span className="font-mono text-[9px] text-emerald-500/40">{hint}</span>
			) : null}
		</div>
	);
}

interface EscapeHudProps {
	state: GameState;
	spent: number;
	promptTokens: number;
	completionTokens: number;
	className?: string;
}

export function EscapeHud({
	state,
	spent,
	promptTokens,
	completionTokens,
	className,
}: EscapeHudProps) {
	const used = state.step / state.stepBudget;
	const critical = state.stepBudget - state.step <= 5;

	return (
		<div
			className={cn(
				"rounded-xl border border-emerald-500/20 bg-[#04070a]/90 p-4",
				className,
			)}
		>
			<div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
				<Stat
					label="Steps"
					value={`${state.step}/${state.stepBudget}`}
					tone={critical ? "rose" : "default"}
					hint={`par ${state.par}`}
				/>
				<Stat
					label="Key fragments"
					value={`${state.collected}/${state.totalShards}`}
					tone="amber"
					hint={state.shards.length === 0 ? "port open" : "port sealed"}
				/>
				<Stat
					label="Credits burned"
					value={formatCredits(spent)}
					tone="cyan"
					hint={`${promptTokens + completionTokens} tokens`}
				/>
				<Stat
					label="Tokens in / out"
					value={`${promptTokens} / ${completionTokens}`}
					hint="every step is one call"
				/>
			</div>

			<div className="mt-4">
				<div className="h-1.5 w-full overflow-hidden rounded-full bg-emerald-950">
					<motion.div
						className={cn(
							"h-full rounded-full",
							critical ? "bg-rose-400" : "bg-emerald-400",
						)}
						animate={{ width: `${Math.min(used, 1) * 100}%` }}
						transition={{ type: "spring", stiffness: 200, damping: 30 }}
					/>
				</div>
				<p className="mt-2 font-mono text-[10px] text-emerald-500/45">
					Compute budget — when it runs out, the sandbox reclaims the process.
				</p>
			</div>
		</div>
	);
}
