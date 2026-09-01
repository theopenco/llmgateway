"use client";

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

interface BoardRow {
	flight: string;
	carrier: string;
	gate: string;
	status: string;
	tone: "ok" | "new" | "hold";
}

const ROWS: BoardRow[] = [
	{
		flight: "GLM-5.2",
		carrier: "EMBERCLOUD",
		gate: "A12",
		status: "BOARDING",
		tone: "ok",
	},
	{
		flight: "LARGE-4",
		carrier: "MISTRAL",
		gate: "B03",
		status: "FARE FILED",
		tone: "new",
	},
	{
		flight: "K3-TURBO",
		carrier: "MOONSHOT",
		gate: "C07",
		status: "ON TIME",
		tone: "ok",
	},
	{
		flight: "CODESTRAL-3",
		carrier: "MISTRAL",
		gate: "B04",
		status: "CLEARED",
		tone: "ok",
	},
	{
		flight: "V3.4-EXP",
		carrier: "DEEPSEEK",
		gate: "D01",
		status: "REVIEW",
		tone: "hold",
	},
];

function FlapText({ text, delay }: { text: string; delay: number }) {
	return (
		<span aria-label={text} className="inline-flex gap-px">
			{text.split("").map((char, i) => {
				const charDelay = i * 35;
				return (
					<span
						key={`${text}-${i}`}
						className={cn(
							"animate-flap bg-foreground/5 inline-block min-w-[1ch] rounded-[2px] px-px text-center",
							char === " " && "bg-transparent",
						)}
						style={{ animationDelay: `${delay + charDelay}ms` }}
					>
						{char}
					</span>
				);
			})}
		</span>
	);
}

const toneClass = {
	ok: "text-signal",
	new: "text-primary",
	hold: "text-muted-foreground",
} as const;

/** Split-flap departure board listing model "flights". */
export function DepartureBoard() {
	// Re-key rows periodically so the flaps re-run — quiet, ambient motion.
	const [cycle, setCycle] = useState(0);

	useEffect(() => {
		const timer = setInterval(() => {
			setCycle((c) => c + 1);
		}, 9000);
		return () => clearInterval(timer);
	}, []);

	return (
		<div className="border-border bg-card overflow-hidden rounded-xl border shadow-2xl">
			<div className="border-border text-muted-foreground flex items-center justify-between border-b px-4 py-2.5 font-mono text-[0.65rem] tracking-[0.25em] uppercase">
				<span>Departures — model traffic</span>
				<span className="text-primary animate-beacon">● LIVE</span>
			</div>
			<div className="overflow-x-auto">
				<table className="w-full font-mono text-xs sm:text-sm">
					<thead>
						<tr className="text-muted-foreground text-left text-[0.65rem] tracking-[0.2em] uppercase">
							<th className="px-4 py-2 font-normal">Model</th>
							<th className="px-4 py-2 font-normal">Carrier</th>
							<th className="hidden px-4 py-2 font-normal sm:table-cell">
								Gate
							</th>
							<th className="px-4 py-2 font-normal">Status</th>
						</tr>
					</thead>
					<tbody key={cycle}>
						{ROWS.map((row, i) => {
							const rowDelay = i * 120;
							return (
								<tr
									key={row.flight}
									className="border-border/50 border-t tracking-wider"
								>
									<td className="px-4 py-2.5">
										<FlapText text={row.flight} delay={rowDelay} />
									</td>
									<td className="text-muted-foreground px-4 py-2.5">
										<FlapText text={row.carrier} delay={rowDelay + 60} />
									</td>
									<td className="text-muted-foreground hidden px-4 py-2.5 sm:table-cell">
										<FlapText text={row.gate} delay={rowDelay + 90} />
									</td>
									<td className={cn("px-4 py-2.5", toneClass[row.tone])}>
										<FlapText text={row.status} delay={rowDelay + 120} />
									</td>
								</tr>
							);
						})}
					</tbody>
				</table>
			</div>
		</div>
	);
}
