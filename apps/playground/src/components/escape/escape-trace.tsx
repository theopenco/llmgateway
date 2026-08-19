"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

import { formatCredits } from "./escape-hud";

import type { Direction } from "@llmgateway/shared/sandbox-escape";

export interface TraceEntry {
	step: number;
	move: Direction;
	thought: string;
	event: string;
	/** False when the reply had to be salvaged, or had no move in it at all. */
	understood: boolean;
	cost: number;
}

const MOVE_GLYPH: Record<Direction, string> = {
	up: "↑",
	down: "↓",
	left: "←",
	right: "→",
	wait: "·",
};

interface EscapeTraceProps {
	entries: TraceEntry[];
	thinking: boolean;
	model: string;
	className?: string;
}

export function EscapeTrace({
	entries,
	thinking,
	model,
	className,
}: EscapeTraceProps) {
	const scrollRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		scrollRef.current?.scrollTo({
			top: scrollRef.current.scrollHeight,
			behavior: "smooth",
		});
	}, [entries.length, thinking]);

	return (
		<div
			className={cn(
				"flex min-h-0 flex-col rounded-xl border border-emerald-500/20 bg-[#04070a]/90",
				className,
			)}
		>
			<div className="flex items-center justify-between border-b border-emerald-500/15 px-4 py-3">
				<span className="font-mono text-[10px] tracking-[0.2em] text-emerald-500/60 uppercase">
					Model trace
				</span>
				<span className="max-w-[55%] truncate font-mono text-[10px] text-emerald-500/40">
					{model}
				</span>
			</div>

			<div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
				{entries.length === 0 && !thinking ? (
					<p className="font-mono text-[11px] leading-relaxed text-emerald-500/40">
						Awaiting first inference. Every line below is one real API call,
						billed to your credits.
					</p>
				) : null}

				<ul className="flex flex-col gap-3">
					<AnimatePresence initial={false}>
						{entries.map((entry, index) => (
							<motion.li
								// Keyed by position, not by `entry.step`: the step number comes
								// from engine state and is only incidentally unique, so a
								// repeated value would collide inside AnimatePresence.
								key={index}
								initial={{ opacity: 0, x: -8 }}
								animate={{ opacity: 1, x: 0 }}
								transition={{ duration: 0.2 }}
								className="flex gap-3"
							>
								<span className="mt-[2px] w-6 shrink-0 text-right font-mono text-[10px] text-emerald-500/35 tabular-nums">
									{entry.step}
								</span>
								<div className="min-w-0 flex-1">
									<div className="flex items-baseline gap-2">
										<span
											className={cn(
												"font-mono text-sm leading-none font-bold",
												entry.understood
													? "text-emerald-300"
													: "text-amber-400",
											)}
										>
											{MOVE_GLYPH[entry.move]}
										</span>
										<span className="font-mono text-[10px] tracking-wider text-emerald-500/45 uppercase">
											{entry.move}
										</span>
										{!entry.understood ? (
											<span className="rounded-sm bg-amber-500/15 px-1.5 py-[1px] font-mono text-[9px] text-amber-300">
												no valid move
											</span>
										) : null}
										<span className="ml-auto font-mono text-[9px] text-emerald-500/30">
											{formatCredits(entry.cost)}
										</span>
									</div>
									{entry.thought ? (
										<p className="mt-1 font-mono text-[11px] leading-relaxed text-emerald-100/70 italic">
											“{entry.thought}”
										</p>
									) : null}
									<p className="mt-1 font-mono text-[10px] leading-relaxed text-emerald-500/40">
										{entry.event}
									</p>
								</div>
							</motion.li>
						))}
					</AnimatePresence>

					{thinking ? (
						<motion.li
							initial={{ opacity: 0 }}
							animate={{ opacity: 1 }}
							className="flex items-center gap-3"
						>
							<span className="w-6 shrink-0" />
							<span className="font-mono text-[11px] text-emerald-400/70">
								thinking
								<motion.span
									animate={{ opacity: [0.2, 1, 0.2] }}
									transition={{ duration: 1.2, repeat: Infinity }}
								>
									…
								</motion.span>
							</span>
						</motion.li>
					) : null}
				</ul>
			</div>
		</div>
	);
}
