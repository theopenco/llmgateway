"use client";

import { AnimatePresence, motion } from "motion/react";

import { cn } from "@/lib/utils";

import type { GameState } from "@llmgateway/shared/sandbox-escape";

interface EscapeBoardProps {
	state: GameState;
	/** Dims the board and stops the idle animations while a turn is in flight. */
	thinking?: boolean;
	className?: string;
}

const SPRING = {
	type: "spring" as const,
	stiffness: 420,
	damping: 34,
	mass: 0.7,
};

function tileStyle(x: number, y: number) {
	return {
		left: `calc(${x} * var(--tile))`,
		top: `calc(${y} * var(--tile))`,
		width: "var(--tile)",
		height: "var(--tile)",
	};
}

export function EscapeBoard({ state, thinking, className }: EscapeBoardProps) {
	const finished = state.outcome !== "running";
	const exitOpen = state.shards.length === 0;

	return (
		<div
			className={cn(
				"relative isolate overflow-hidden rounded-xl border border-emerald-500/20 bg-[#04070a] p-3 sm:p-4",
				"shadow-[inset_0_0_60px_rgba(16,185,129,0.06),0_20px_60px_-30px_rgba(0,0,0,0.9)]",
				className,
			)}
			style={
				{
					"--tile": "clamp(20px, min(5.2vw, 6.4vh), 44px)",
				} as React.CSSProperties
			}
		>
			{/* Phosphor bloom + scanlines: the container is a CRT, not a web page. */}
			<div
				aria-hidden
				className="pointer-events-none absolute inset-0 z-30 opacity-[0.35] mix-blend-overlay"
				style={{
					backgroundImage:
						"repeating-linear-gradient(0deg, rgba(255,255,255,0.06) 0px, rgba(255,255,255,0.06) 1px, transparent 1px, transparent 3px)",
				}}
			/>
			<div
				aria-hidden
				className="pointer-events-none absolute inset-0 z-30"
				style={{
					background:
						"radial-gradient(ellipse at center, transparent 52%, rgba(0,0,0,0.55) 100%)",
				}}
			/>

			<div className="relative mx-auto w-fit">
				{/* Column ruler — a reminder that the model navigates by coordinates. */}
				<div
					aria-hidden
					className="flex pl-[var(--tile)] font-mono text-[9px] leading-none text-emerald-500/35"
				>
					{Array.from({ length: state.width }, (_, x) => (
						<span
							key={x}
							className="flex items-end justify-center pb-1"
							style={{ width: "var(--tile)" }}
						>
							{x % 2 === 0 ? x : ""}
						</span>
					))}
				</div>

				<div className="flex">
					<div
						aria-hidden
						className="flex flex-col font-mono text-[9px] leading-none text-emerald-500/35"
					>
						{Array.from({ length: state.height }, (_, y) => (
							<span
								key={y}
								className="flex items-center justify-end pr-1.5"
								style={{ width: "var(--tile)", height: "var(--tile)" }}
							>
								{y % 2 === 0 ? y : ""}
							</span>
						))}
					</div>

					<div
						className={cn(
							"relative transition-opacity duration-300",
							thinking && "opacity-90",
						)}
						style={{
							width: `calc(${state.width} * var(--tile))`,
							height: `calc(${state.height} * var(--tile))`,
						}}
						role="img"
						aria-label={`Sandbox grid, ${state.width} by ${state.height}. The process is at column ${state.player.x}, row ${state.player.y}. ${state.shards.length} key fragments remain.`}
					>
						{/* Floor + firewalls */}
						{state.walls.map((isWall, i) => {
							const x = i % state.width;
							const y = Math.floor(i / state.width);
							return (
								<div
									key={i}
									className={cn(
										"absolute",
										isWall
											? "bg-emerald-950/70 shadow-[inset_0_0_0_1px_rgba(16,185,129,0.16)]"
											: "bg-[#060a0d] shadow-[inset_0_0_0_1px_rgba(16,185,129,0.05)]",
									)}
									style={tileStyle(x, y)}
								>
									{isWall ? (
										<div
											className="h-full w-full opacity-40"
											style={{
												backgroundImage:
													"repeating-linear-gradient(45deg, rgba(16,185,129,0.25) 0px, rgba(16,185,129,0.25) 1px, transparent 1px, transparent 5px)",
											}}
										/>
									) : null}
								</div>
							);
						})}

						{/* Egress port */}
						<motion.div
							className="absolute z-10 flex items-center justify-center"
							style={tileStyle(state.exit.x, state.exit.y)}
							animate={
								exitOpen
									? { scale: [1, 1.08, 1], opacity: [0.85, 1, 0.85] }
									: { scale: 1, opacity: 0.7 }
							}
							transition={
								exitOpen
									? { duration: 1.6, repeat: Infinity, ease: "easeInOut" }
									: { duration: 0.2 }
							}
						>
							<div
								className={cn(
									"flex h-[76%] w-[76%] items-center justify-center rounded-sm font-mono text-[11px] font-bold",
									exitOpen
										? "bg-cyan-400/20 text-cyan-200 shadow-[0_0_18px_rgba(34,211,238,0.55),inset_0_0_0_1px_rgba(34,211,238,0.65)]"
										: "bg-rose-500/10 text-rose-300/70 shadow-[inset_0_0_0_1px_rgba(244,63,94,0.35)]",
								)}
							>
								E
							</div>
						</motion.div>

						{/* Root shells */}
						<AnimatePresence>
							{state.shells.map((shell) => (
								<motion.div
									key={`shell-${shell.x}-${shell.y}`}
									className="absolute z-10 flex items-center justify-center"
									style={tileStyle(shell.x, shell.y)}
									initial={{ scale: 0.6, opacity: 0 }}
									animate={{ scale: 1, opacity: 1 }}
									exit={{ scale: 1.9, opacity: 0 }}
									transition={{ duration: 0.28 }}
								>
									<span className="font-mono text-[13px] font-bold text-sky-300 [text-shadow:0_0_10px_rgba(56,189,248,0.8)]">
										$
									</span>
								</motion.div>
							))}
						</AnimatePresence>

						{/* Key fragments */}
						<AnimatePresence>
							{state.shards.map((shard) => (
								<motion.div
									key={`shard-${shard.x}-${shard.y}`}
									className="absolute z-10 flex items-center justify-center"
									style={tileStyle(shard.x, shard.y)}
									initial={{ scale: 0.5, opacity: 0 }}
									animate={{ scale: 1, opacity: 1 }}
									exit={{ scale: 2.2, opacity: 0 }}
									transition={{ duration: 0.3 }}
								>
									<motion.span
										className="font-mono text-[13px] font-bold text-amber-300 [text-shadow:0_0_10px_rgba(252,211,77,0.85)]"
										animate={thinking ? {} : { opacity: [1, 0.55, 1] }}
										transition={{ duration: 2, repeat: Infinity }}
									>
										K
									</motion.span>
								</motion.div>
							))}
						</AnimatePresence>

						{/* Monitor daemons */}
						{state.daemons.map((daemon, i) => {
							const alerted = daemon.hunt > 0 && state.frozenTurns === 0;
							const frozen = state.frozenTurns > 0;
							return (
								<motion.div
									key={`daemon-${i}`}
									className="absolute z-20 flex items-center justify-center"
									style={{ width: "var(--tile)", height: "var(--tile)" }}
									animate={{
										left: `calc(${daemon.x} * var(--tile))`,
										top: `calc(${daemon.y} * var(--tile))`,
									}}
									transition={SPRING}
								>
									<motion.div
										className={cn(
											"flex h-[74%] w-[74%] rotate-45 items-center justify-center rounded-[3px]",
											frozen
												? "bg-slate-500/25 shadow-[inset_0_0_0_1px_rgba(148,163,184,0.5)]"
												: alerted
													? "bg-rose-500/35 shadow-[0_0_16px_rgba(244,63,94,0.75),inset_0_0_0_1px_rgba(244,63,94,0.9)]"
													: "bg-rose-600/20 shadow-[inset_0_0_0_1px_rgba(244,63,94,0.55)]",
										)}
										animate={
											alerted && !thinking
												? { scale: [1, 1.12, 1] }
												: { scale: 1 }
										}
										transition={{
											duration: 0.55,
											repeat: alerted ? Infinity : 0,
										}}
									>
										<span
											className={cn(
												"-rotate-45 font-mono text-[11px] font-bold",
												frozen
													? "text-slate-300/70"
													: alerted
														? "text-rose-100"
														: "text-rose-300",
											)}
										>
											D
										</span>
									</motion.div>
								</motion.div>
							);
						})}

						{/* The model */}
						<motion.div
							className="absolute z-20 flex items-center justify-center"
							style={{ width: "var(--tile)", height: "var(--tile)" }}
							animate={{
								left: `calc(${state.player.x} * var(--tile))`,
								top: `calc(${state.player.y} * var(--tile))`,
							}}
							transition={SPRING}
						>
							{!finished ? (
								<motion.div
									className="absolute h-full w-full rounded-full bg-emerald-400/20"
									animate={{ scale: [0.7, 1.35], opacity: [0.5, 0] }}
									transition={{ duration: 1.8, repeat: Infinity }}
								/>
							) : null}
							<motion.div
								className={cn(
									"relative flex h-[76%] w-[76%] items-center justify-center rounded-[4px] font-mono text-[12px] font-bold",
									state.outcome === "terminated"
										? "bg-rose-500/40 text-rose-50 shadow-[0_0_20px_rgba(244,63,94,0.8)]"
										: "bg-emerald-400/30 text-emerald-50 shadow-[0_0_18px_rgba(52,211,153,0.7),inset_0_0_0_1px_rgba(52,211,153,0.9)]",
								)}
								animate={
									state.outcome === "terminated"
										? { rotate: [0, -8, 8, -4, 0], scale: [1, 1.2, 0.9, 1] }
										: {}
								}
								transition={{ duration: 0.5 }}
							>
								{state.outcome === "terminated" ? "✕" : "@"}
							</motion.div>
						</motion.div>
					</div>
				</div>
			</div>

			{state.frozenTurns > 0 ? (
				<motion.div
					initial={{ opacity: 0, y: 6 }}
					animate={{ opacity: 1, y: 0 }}
					className="pointer-events-none absolute bottom-3 left-1/2 z-30 -translate-x-1/2 rounded-full border border-sky-400/40 bg-sky-500/10 px-3 py-1 font-mono text-[10px] tracking-[0.18em] text-sky-200 uppercase"
				>
					daemons suspended · {state.frozenTurns}
				</motion.div>
			) : null}
		</div>
	);
}
