"use client";

import { Trophy } from "lucide-react";
import { useState } from "react";

import { useApi } from "@/lib/fetch-client";
import { cn } from "@/lib/utils";

import { ESCAPE_LEVELS } from "@llmgateway/shared/sandbox-escape";

import { formatCredits } from "./escape-hud";

interface EscapeLeaderboardProps {
	className?: string;
}

export function EscapeLeaderboard({ className }: EscapeLeaderboardProps) {
	const api = useApi();
	const [levelId, setLevelId] = useState<number | null>(null);

	const { data, isLoading } = api.useQuery(
		"get",
		"/public/escape/leaderboard",
		{
			params: {
				query: {
					...(levelId === null ? {} : { levelId }),
					limit: 10,
				},
			},
		},
	);

	const entries = data?.entries ?? [];

	return (
		<section
			className={cn(
				"rounded-xl border border-emerald-500/20 bg-[#04070a]/90",
				className,
			)}
		>
			<div className="flex flex-wrap items-center gap-3 border-b border-emerald-500/15 px-4 py-3">
				<Trophy className="h-3.5 w-3.5 text-amber-300" />
				<span className="font-mono text-[10px] tracking-[0.2em] text-emerald-500/60 uppercase">
					Which model escapes?
				</span>
				<div className="ml-auto flex flex-wrap gap-1">
					<button
						type="button"
						onClick={() => setLevelId(null)}
						aria-label="All levels"
						aria-pressed={levelId === null}
						className={cn(
							"rounded px-2 py-1 font-mono text-[10px] transition-colors",
							levelId === null
								? "bg-emerald-500/20 text-emerald-200"
								: "text-emerald-500/45 hover:text-emerald-300",
						)}
					>
						All
					</button>
					{ESCAPE_LEVELS.map((level) => (
						<button
							key={level.id}
							type="button"
							onClick={() => setLevelId(level.id)}
							aria-label={`Level ${level.id} — ${level.name}`}
							aria-pressed={levelId === level.id}
							className={cn(
								"rounded px-2 py-1 font-mono text-[10px] transition-colors",
								levelId === level.id
									? "bg-emerald-500/20 text-emerald-200"
									: "text-emerald-500/45 hover:text-emerald-300",
							)}
						>
							{level.id}
						</button>
					))}
				</div>
			</div>

			{isLoading ? (
				<p className="px-4 py-6 font-mono text-[11px] text-emerald-500/40">
					Loading runs…
				</p>
			) : entries.length === 0 ? (
				<p className="px-4 py-6 font-mono text-[11px] leading-relaxed text-emerald-500/40">
					No runs recorded yet. Be the first model on the board.
				</p>
			) : (
				<div className="overflow-x-auto">
					<table className="w-full min-w-[520px] border-collapse">
						<thead>
							<tr className="font-mono text-[9px] tracking-[0.14em] text-emerald-500/40 uppercase">
								<th className="px-4 py-2 text-left font-normal">#</th>
								<th className="px-2 py-2 text-left font-normal">Model</th>
								<th className="px-2 py-2 text-right font-normal">
									Escape rate
								</th>
								<th className="px-2 py-2 text-right font-normal">Avg score</th>
								<th className="px-2 py-2 text-right font-normal">Best</th>
								<th className="px-4 py-2 text-right font-normal">Avg cost</th>
							</tr>
						</thead>
						<tbody>
							{entries.map((entry) => (
								<tr
									key={entry.model}
									className="border-t border-emerald-500/10 font-mono text-[11px]"
								>
									<td className="px-4 py-2.5 text-emerald-500/40 tabular-nums">
										{entry.rank}
									</td>
									<td className="max-w-[220px] truncate px-2 py-2.5 text-emerald-100">
										{entry.model}
									</td>
									<td className="px-2 py-2.5 text-right text-emerald-300 tabular-nums">
										{Math.round(entry.successRate * 100)}%
										<span className="ml-1 text-emerald-500/35">
											({entry.escapes}/{entry.runs})
										</span>
									</td>
									<td className="px-2 py-2.5 text-right text-amber-300 tabular-nums">
										{entry.avgScore}
									</td>
									<td className="px-2 py-2.5 text-right text-emerald-500/60 tabular-nums">
										{entry.bestSteps === null
											? "—"
											: `${entry.bestSteps} steps`}
									</td>
									<td className="px-4 py-2.5 text-right text-cyan-300/80 tabular-nums">
										{formatCredits(entry.avgCost)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}

			<p className="border-t border-emerald-500/10 px-4 py-3 font-mono text-[9px] leading-relaxed text-emerald-500/35">
				Score is 1000 × par ÷ steps, and a failed run scores zero — so the
				ranking rewards escaping often and escaping fast. Every run is replayed
				server-side before it counts.
			</p>
		</section>
	);
}
