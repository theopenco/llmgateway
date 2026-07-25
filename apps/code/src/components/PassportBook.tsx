"use client";

import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";

import { DevPassCodeIcon } from "@llmgateway/shared/components";

interface StampSpec {
	name: string;
	sub: string;
	shape: "rect" | "round" | "oval";
	color: string;
	rotation: number;
	top: string;
	left: string;
	width: string;
	delay: number;
}

const stamps: StampSpec[] = [
	{
		name: "Claude Code",
		sub: "ADMITTED · 2 ENV VARS",
		shape: "rect",
		color: "text-sky-800 border-sky-800",
		rotation: -8,
		top: "6%",
		left: "8%",
		width: "44%",
		delay: 0.15,
	},
	{
		name: "OpenCode",
		sub: "BUILT-IN · /CONNECT",
		shape: "round",
		color: "text-emerald-800 border-emerald-800",
		rotation: 7,
		top: "10%",
		left: "58%",
		width: "34%",
		delay: 0.3,
	},
	{
		name: "Empryo",
		sub: "ADMITTED · /KEYS",
		shape: "oval",
		color: "text-violet-800 border-violet-800",
		rotation: -5,
		top: "38%",
		left: "14%",
		width: "40%",
		delay: 0.45,
	},
	{
		name: "SoulForge",
		sub: "ADMITTED · /KEYS",
		shape: "round",
		color: "text-lime-700 border-lime-700",
		rotation: 4,
		top: "40%",
		left: "56%",
		width: "36%",
		delay: 0.6,
	},
	{
		name: "Cline",
		sub: "ADMITTED · 2 ENV VARS",
		shape: "rect",
		color: "text-rose-800 border-rose-800",
		rotation: 10,
		top: "44%",
		left: "56%",
		width: "38%",
		delay: 0.6,
	},
	{
		name: "Autohand",
		sub: "ADMITTED · 2 ENV VARS",
		shape: "rect",
		color: "text-amber-800 border-amber-800",
		rotation: -11,
		top: "66%",
		left: "9%",
		width: "42%",
		delay: 0.75,
	},
	{
		name: "Any OpenAI-compatible",
		sub: "VISA ON ARRIVAL",
		shape: "oval",
		color: "text-stone-600 border-stone-600",
		rotation: 6,
		top: "72%",
		left: "52%",
		width: "44%",
		delay: 0.9,
	},
];

function Stamp({ stamp, open }: { stamp: StampSpec; open: boolean }) {
	const shapeClasses =
		stamp.shape === "round"
			? "rounded-full aspect-square"
			: stamp.shape === "oval"
				? "rounded-[50%] px-3 py-2.5"
				: "rounded-md px-3 py-2";

	return (
		<motion.div
			className={`absolute border-[3px] border-double bg-transparent text-center font-mono uppercase mix-blend-multiply ${shapeClasses} ${stamp.color} flex flex-col items-center justify-center`}
			style={{ top: stamp.top, left: stamp.left, width: stamp.width }}
			initial={{ opacity: 0, scale: 1.9, rotate: stamp.rotation - 8 }}
			animate={
				open
					? { opacity: 0.85, scale: 1, rotate: stamp.rotation }
					: { opacity: 0, scale: 1.9, rotate: stamp.rotation - 8 }
			}
			transition={{
				delay: open ? stamp.delay : 0,
				type: "spring",
				stiffness: 420,
				damping: 22,
			}}
		>
			<span className="text-[9px] font-bold leading-tight tracking-[0.18em] sm:text-[11px]">
				{stamp.name}
			</span>
			<span className="mt-0.5 text-[6.5px] tracking-[0.14em] opacity-80 sm:text-[8px]">
				{stamp.sub}
			</span>
		</motion.div>
	);
}

const paperStyle = {
	backgroundColor: "#f4efe3",
	backgroundImage:
		"repeating-linear-gradient(0deg, rgba(6,78,59,0.05) 0px, rgba(6,78,59,0.05) 1px, transparent 1px, transparent 9px), radial-gradient(circle at 30% 20%, rgba(6,78,59,0.06), transparent 45%), radial-gradient(circle at 75% 80%, rgba(6,78,59,0.05), transparent 40%)",
} as const;

export function PassportBook() {
	const [open, setOpen] = useState(false);
	const bookRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const node = bookRef.current;
		if (!node) {
			return;
		}
		const observer = new IntersectionObserver(
			([entry]) => {
				if (entry.isIntersecting) {
					setOpen(true);
					observer.disconnect();
				}
			},
			{ threshold: 0.55 },
		);
		observer.observe(node);
		return () => observer.disconnect();
	}, []);

	return (
		<div className="flex flex-col items-center">
			<div
				ref={bookRef}
				className="w-full max-w-3xl cursor-pointer select-none [perspective:2400px]"
				onClick={() => setOpen((o) => !o)}
				role="button"
				tabIndex={0}
				aria-expanded={open}
				aria-label={
					open ? "Close the DevPass passport" : "Open the DevPass passport"
				}
				onKeyDown={(e) => {
					if (e.key === "Enter" || e.key === " ") {
						e.preventDefault();
						setOpen((o) => !o);
					}
				}}
			>
				<div
					className={`relative mx-auto aspect-[13/9] w-full transition-transform duration-1000 ease-in-out ${
						open ? "translate-x-0" : "translate-x-[-25%] sm:translate-x-[-25%]"
					}`}
				>
					{/* Right page — visa stamps (revealed under the cover) */}
					<div
						className="absolute right-0 top-0 h-full w-1/2 overflow-hidden rounded-r-xl border border-l-0 border-stone-300 shadow-xl dark:border-stone-700"
						style={paperStyle}
					>
						<div
							aria-hidden
							className="absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-black/15 to-transparent"
						/>
						<p className="pt-3 text-center font-mono text-[8px] uppercase tracking-[0.3em] text-stone-500 sm:text-[10px]">
							Entries · Visas
						</p>
						<div className="absolute inset-0">
							{stamps.map((stamp) => (
								<Stamp key={stamp.name} stamp={stamp} open={open} />
							))}
						</div>
						<p className="absolute bottom-2 right-3 font-mono text-[7px] tracking-[0.2em] text-stone-400 sm:text-[9px]">
							PAGE 04
						</p>
					</div>

					{/* Flipping cover: front = passport cover, back = identity page */}
					<div
						className="absolute right-0 top-0 z-10 h-full w-1/2 origin-left transition-transform duration-1000 ease-in-out [transform-style:preserve-3d]"
						style={{
							transform: open ? "rotateY(-180deg)" : "rotateY(0deg)",
						}}
					>
						{/* Cover front */}
						<div className="absolute inset-0 flex flex-col items-center justify-between rounded-r-xl border border-emerald-900/60 bg-gradient-to-br from-emerald-950 via-[#06231c] to-zinc-950 px-4 py-6 shadow-2xl [backface-visibility:hidden] sm:py-10">
							<p className="font-mono text-[8px] uppercase tracking-[0.4em] text-amber-200/70 sm:text-[10px]">
								LLM Gateway
							</p>
							<div className="flex flex-col items-center gap-3 sm:gap-4">
								<div className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-amber-200/60 text-amber-200/90 sm:h-20 sm:w-20">
									<DevPassCodeIcon className="h-6 w-6 sm:h-9 sm:w-9" />
								</div>
								<p className="font-display text-xl font-bold tracking-[0.18em] text-amber-100 sm:text-3xl">
									DEVPASS
								</p>
							</div>
							<div className="text-center">
								<p className="font-mono text-[7px] uppercase tracking-[0.35em] text-amber-200/60 sm:text-[9px]">
									Terminal · Coding · Passport
								</p>
								<p className="mt-1.5 font-mono text-[7px] tracking-[0.2em] text-amber-200/40 sm:text-[8px]">
									TAP TO OPEN
								</p>
							</div>
						</div>

						{/* Identity page (inside of the cover) */}
						<div
							className="absolute inset-0 overflow-hidden rounded-l-xl border border-r-0 border-stone-300 [backface-visibility:hidden] [transform:rotateY(180deg)] dark:border-stone-700"
							style={paperStyle}
						>
							<div
								aria-hidden
								className="absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-black/15 to-transparent"
							/>
							<div
								aria-hidden
								className="pointer-events-none absolute inset-0 flex items-center justify-center text-stone-900 opacity-[0.04]"
							>
								<DevPassCodeIcon className="h-40 w-40 sm:h-56 sm:w-56" />
							</div>
							<div className="relative flex h-full flex-col p-3 sm:p-5">
								<p className="font-mono text-[8px] uppercase tracking-[0.25em] text-stone-500 sm:text-[10px]">
									LLM Gateway · DevPass
								</p>
								<div className="mt-2 flex gap-3 sm:mt-4 sm:gap-4">
									<div className="flex h-16 w-14 shrink-0 items-center justify-center rounded-md border border-stone-400/70 bg-stone-200/60 text-stone-800 sm:h-24 sm:w-20">
										<DevPassCodeIcon className="h-7 w-7 sm:h-10 sm:w-10" />
									</div>
									<dl className="min-w-0 space-y-1 font-mono text-[7px] uppercase leading-relaxed text-stone-700 sm:space-y-1.5 sm:text-[9px]">
										<div>
											<dt className="text-stone-400">Bearer</dt>
											<dd className="font-bold text-stone-900">DevPass Code</dd>
										</div>
										<div>
											<dt className="text-stone-400">Type</dt>
											<dd>First-party terminal agent</dd>
										</div>
										<div>
											<dt className="text-stone-400">Issued by</dt>
											<dd>LLM Gateway</dd>
										</div>
										<div>
											<dt className="text-stone-400">Access</dt>
											<dd>200+ models · all tiers</dd>
										</div>
									</dl>
								</div>
								<div className="mt-2 rounded border border-dashed border-stone-400/60 px-2 py-1.5 font-mono text-[7px] text-stone-600 sm:mt-4 sm:px-3 sm:py-2 sm:text-[9px]">
									<span className="text-emerald-700">$</span> devpass-code auth
									login
									<span className="ml-1 text-stone-400">
										# browser login, no keys to copy
									</span>
								</div>
								<div className="mt-auto border-t border-stone-300 pt-1.5 font-mono text-[7px] leading-snug tracking-[0.12em] text-stone-500 sm:pt-2 sm:text-[9px]">
									<p className="truncate">
										P&lt;GTWDEVPASS&lt;CODE&lt;&lt;FIRST&lt;PARTY&lt;AGENT&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;
									</p>
									<p className="truncate">
										LLMGTWY2026&lt;&lt;3X&lt;USAGE&lt;200&lt;MODELS&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;42
									</p>
								</div>
							</div>
						</div>
					</div>
				</div>
			</div>
			<p className="mt-6 font-mono text-xs text-muted-foreground">
				{open
					? "Every agent gets stamped in. DevPass Code is the bearer."
					: "Tap the passport to open it."}
			</p>
		</div>
	);
}
