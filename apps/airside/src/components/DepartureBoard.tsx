"use client";

import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

interface BoardRow {
	flight: string;
	carrier: string;
	gate: string;
	status: string;
	tone: "ok" | "new";
}

const ROWS: BoardRow[] = [
	{
		flight: "GPT-5.6-SOL",
		carrier: "OPENAI",
		gate: "A01",
		status: "BOARDING",
		tone: "ok",
	},
	{
		flight: "GPT-5.6-TERRA",
		carrier: "OPENAI",
		gate: "A02",
		status: "ON TIME",
		tone: "ok",
	},
	{
		flight: "GPT-5.6-LUNA",
		carrier: "OPENAI",
		gate: "A03",
		status: "ON TIME",
		tone: "ok",
	},
	{
		flight: "OPUS-5",
		carrier: "ANTHROPIC",
		gate: "B01",
		status: "BOARDING",
		tone: "ok",
	},
	{
		flight: "FABLE-5",
		carrier: "ANTHROPIC",
		gate: "B02",
		status: "NEW ROUTE",
		tone: "new",
	},
	{
		flight: "KIMI-K3",
		carrier: "MOONSHOT",
		gate: "C01",
		status: "ON TIME",
		tone: "ok",
	},
	{
		flight: "DEEPSEEK-V4-PRO",
		carrier: "DEEPSEEK",
		gate: "D01",
		status: "BOARDING",
		tone: "ok",
	},
	{
		flight: "DEEPSEEK-V4-FLASH",
		carrier: "DEEPSEEK",
		gate: "D02",
		status: "ON TIME",
		tone: "ok",
	},
	{
		flight: "MIMO-V2.5",
		carrier: "XIAOMI",
		gate: "E01",
		status: "CLEARED",
		tone: "ok",
	},
	{
		flight: "GLM-5.3",
		carrier: "Z.AI",
		gate: "F01",
		status: "ON TIME",
		tone: "ok",
	},
	{
		flight: "MINIMAX-M3",
		carrier: "MINIMAX",
		gate: "G01",
		status: "BOARDING",
		tone: "ok",
	},
	{
		flight: "QWEN3.8-MAX",
		carrier: "ALIBABA",
		gate: "H01",
		status: "ON TIME",
		tone: "ok",
	},
	{
		flight: "MUSE-SPARK-1.2",
		carrier: "META",
		gate: "J01",
		status: "NEW ROUTE",
		tone: "new",
	},
];

const VISIBLE_ROW_COUNT = 5;
const CYCLE_INTERVAL_MS = 8_000;

function FlapText({ text, delay }: { text: string; delay: number }) {
	return (
		<span aria-label={text} className="inline-flex gap-px">
			{text.split("").map((char, i) => {
				const charDelay = i * 35;
				return (
					<span
						key={`${text}-${i}`}
						aria-hidden="true"
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
} as const;

/** Split-flap departure board listing model "flights". */
export function DepartureBoard() {
	const [cycle, setCycle] = useState(0);
	const [isActive, setIsActive] = useState(false);
	const boardRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const board = boardRef.current;
		if (!board) {
			return;
		}

		const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
		let isIntersecting = false;

		const updateActivity = () => {
			setIsActive(isIntersecting && !document.hidden && !reducedMotion.matches);
		};
		const observer = new IntersectionObserver(([entry]) => {
			isIntersecting = entry.isIntersecting;
			updateActivity();
		});

		observer.observe(board);
		document.addEventListener("visibilitychange", updateActivity);
		reducedMotion.addEventListener("change", updateActivity);

		return () => {
			observer.disconnect();
			document.removeEventListener("visibilitychange", updateActivity);
			reducedMotion.removeEventListener("change", updateActivity);
		};
	}, []);

	useEffect(() => {
		if (!isActive) {
			return;
		}

		const timer = setInterval(() => {
			setCycle((c) => c + 1);
		}, CYCLE_INTERVAL_MS);
		return () => clearInterval(timer);
	}, [isActive]);

	const visibleRows = Array.from({ length: VISIBLE_ROW_COUNT }, (_, index) => {
		const batchStart = cycle * VISIBLE_ROW_COUNT;
		const rowIndex = (batchStart + index) % ROWS.length;
		return ROWS[rowIndex];
	});

	return (
		<div
			ref={boardRef}
			className="border-border bg-card overflow-hidden rounded-xl border shadow-2xl"
		>
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
						{visibleRows.map((row, i) => {
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
