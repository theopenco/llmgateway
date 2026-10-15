import { ArrowRight, Mic, Play, Sparkles, Volume2 } from "lucide-react";

import { cn } from "@/lib/utils";

import { Chip, VisualFrame, stagger } from "./visual-frame";
import s from "./visuals.module.css";

import type { FeatureVisual } from "@/lib/feature-visuals";
import type { CSSProperties } from "react";

type Props<K extends FeatureVisual["kind"]> = Extract<
	FeatureVisual,
	{ kind: K }
>;

const ART = [
	"radial-gradient(circle at 28% 30%, oklch(0.88 0.13 85) 0, transparent 38%), radial-gradient(circle at 72% 72%, var(--fa) 0, transparent 55%), linear-gradient(140deg, oklch(0.32 0.09 265), oklch(0.2 0.05 300))",
	"radial-gradient(circle at 50% 58%, oklch(0.9 0.12 80) 0, oklch(0.78 0.17 55) 14%, transparent 15%), linear-gradient(180deg, oklch(0.72 0.14 40), oklch(0.58 0.2 15) 58%, oklch(0.26 0.06 280) 58.5%, oklch(0.18 0.04 270))",
	"conic-gradient(from 210deg at 50% 62%, var(--fa), oklch(0.72 0.14 185), oklch(0.62 0.2 320), var(--fa))",
	"radial-gradient(ellipse 80% 45% at 50% 100%, oklch(0.42 0.1 160) 0, transparent 70%), linear-gradient(180deg, oklch(0.83 0.07 230), oklch(0.62 0.12 245) 55%, oklch(0.36 0.08 175) 56%, oklch(0.24 0.05 170))",
];

function PromptBar({ prompt }: { prompt: string }) {
	return (
		<div className="mb-4 flex items-center gap-2 rounded-xl border border-border bg-background/85 px-3 py-2.5 text-[13px]">
			<Sparkles className="size-4 shrink-0 text-[var(--fa)]" />
			<span className="truncate">{prompt}</span>
			<span className={cn(s.blink, "h-4 w-px shrink-0 bg-foreground")} />
		</div>
	);
}

export function MediaVisual({ output, prompt, meta }: Props<"media">) {
	return (
		<VisualFrame
			title={
				output === "image" ? "POST /v1/images/generations" : "POST /v1/videos"
			}
		>
			<PromptBar prompt={prompt} />
			{output === "image" ? (
				<div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
					{ART.map((art, i) => (
						<div
							key={i}
							className={cn(
								s.shimmer,
								"relative aspect-[3/4] overflow-hidden rounded-xl bg-muted",
							)}
						>
							<div
								className={cn(s.reveal, "absolute inset-0")}
								style={{ ...stagger(i), background: art }}
							/>
						</div>
					))}
				</div>
			) : (
				<div>
					<div
						className={cn(
							s.shimmer,
							"relative aspect-video overflow-hidden rounded-xl bg-muted",
						)}
					>
						<div
							className={cn(s.reveal, "absolute inset-0")}
							style={{ background: ART[1] }}
						>
							<div className="absolute inset-0 flex items-center justify-center">
								<span className="flex size-12 items-center justify-center rounded-full bg-black/35 text-white backdrop-blur">
									<Play className="size-5 translate-x-px fill-current" />
								</span>
							</div>
							<div className="absolute inset-x-3 bottom-3 h-1 overflow-hidden rounded-full bg-white/30">
								<div className={cn(s.progress, "h-full bg-white")} />
							</div>
						</div>
					</div>
					<div className="mt-2.5 grid grid-cols-6 gap-1.5">
						{Array.from({ length: 6 }, (_, i) => (
							<div
								key={i}
								className={cn(s.pop, "aspect-video rounded-md")}
								style={{
									...stagger(i),
									background: ART[(i % 3) + 1],
									filter: `hue-rotate(${i * 14}deg)`,
								}}
							/>
						))}
					</div>
				</div>
			)}
			<div className="mt-4 flex">
				<Chip>{meta}</Chip>
			</div>
		</VisualFrame>
	);
}

const BAR_HEIGHTS = [
	0.35, 0.6, 0.9, 0.5, 0.75, 1, 0.65, 0.4, 0.8, 0.55, 0.95, 0.7, 0.45, 0.85,
	0.6, 0.3, 0.7, 1, 0.5, 0.8, 0.4, 0.65, 0.9, 0.55, 0.75, 0.35, 0.6, 0.85, 0.5,
	0.7, 0.45, 0.9, 0.6, 0.4, 0.8, 0.55,
];

function barOpacity(height: number) {
	const scaled = height * 0.55;
	return 0.45 + scaled;
}

function timestamp(index: number) {
	const offset = index * 0.42;
	return (0.24 + offset).toFixed(2);
}

function Waveform({
	bars = 36,
	className,
}: {
	bars?: number;
	className?: string;
}) {
	return (
		<div
			className={cn("flex h-16 items-center gap-[3px]", className)}
			aria-hidden
		>
			{BAR_HEIGHTS.slice(0, bars).map((h, i) => (
				<span
					key={i}
					className={cn(s.wave, "w-full rounded-full bg-[var(--fa)]")}
					style={
						{
							...stagger(i),
							height: `${h * 100}%`,
							opacity: barOpacity(h),
						} as CSSProperties
					}
				/>
			))}
		</div>
	);
}

export function AudioVisual({ mode, title, words, meta }: Props<"audio">) {
	return (
		<VisualFrame title={title}>
			{mode === "speech" && (
				<div className="space-y-5">
					<p className="flex flex-wrap gap-x-1 gap-y-1 text-lg font-medium leading-relaxed">
						{words.map((word, i) => (
							<span
								key={i}
								className={cn(s.word, "rounded px-0.5")}
								style={stagger(i)}
							>
								{word}
							</span>
						))}
					</p>
					<div className="flex items-center gap-3 rounded-xl border border-border bg-background/85 p-3">
						<span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--fa)] text-white dark:text-zinc-950">
							<Volume2 className="size-4" />
						</span>
						<Waveform />
					</div>
				</div>
			)}
			{mode === "transcription" && (
				<div className="space-y-5">
					<div className="flex items-center gap-3 rounded-xl border border-border bg-background/85 p-3">
						<span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted">
							<Mic className="size-4 text-[var(--fa)]" />
						</span>
						<Waveform />
					</div>
					<div className="flex flex-wrap gap-2">
						{words.map((word, i) => (
							<span
								key={i}
								className={cn(
									s.pop,
									"rounded-lg border border-border bg-background/85 px-2.5 py-1.5",
								)}
								style={stagger(i * 2)}
							>
								<span className="block font-mono text-[10px] text-muted-foreground">
									{timestamp(i)}s
								</span>
								<span className="text-sm font-medium">{word}</span>
							</span>
						))}
					</div>
				</div>
			)}
			{mode === "realtime" && (
				<div className="space-y-3">
					{words.map((line, i) => {
						const user = i % 2 === 0;
						return (
							<div
								key={i}
								className={cn(
									s.enter,
									"flex items-end gap-2",
									user ? "justify-start" : "justify-end",
								)}
								style={stagger(i * 3)}
							>
								<div
									className={cn(
										"max-w-[80%] rounded-2xl px-3.5 py-2.5",
										user
											? "rounded-bl-md border border-border bg-background/85"
											: "rounded-br-md bg-[color-mix(in_oklab,var(--fa)_16%,transparent)]",
									)}
								>
									<Waveform bars={18} className="mb-1.5 h-6" />
									<p className="text-[13px]">{line}</p>
								</div>
							</div>
						);
					})}
				</div>
			)}
			<div className="mt-4 flex">
				<Chip>{meta}</Chip>
			</div>
		</VisualFrame>
	);
}

export function DocumentVisual({ mode, title, output }: Props<"document">) {
	return (
		<VisualFrame title={title}>
			<div className="grid items-center gap-4 sm:grid-cols-[0.8fr_auto_1.2fr]">
				<div className="relative mx-auto aspect-[3/4] w-full max-w-[11rem] overflow-hidden rounded-lg border border-border bg-background shadow-sm">
					{mode === "vision" ? (
						<div className="absolute inset-0" style={{ background: ART[3] }}>
							{[
								{ l: "18%", t: "52%", w: "34%", h: "26%" },
								{ l: "56%", t: "18%", w: "30%", h: "22%" },
							].map((box, i) => (
								<span
									key={i}
									className={cn(
										s.pop,
										"absolute rounded-md border-2 border-[var(--fa)]",
									)}
									style={{
										...stagger(i + i + i + 2),
										left: box.l,
										top: box.t,
										width: box.w,
										height: box.h,
									}}
								/>
							))}
						</div>
					) : (
						<div className="space-y-2 p-3.5">
							<div className="h-2.5 w-2/3 rounded bg-foreground/70" />
							{[92, 84, 96, 70, 88, 60].map((w, i) => (
								<div
									key={i}
									className="h-1.5 rounded bg-muted-foreground/25"
									style={{ width: `${w}%` }}
								/>
							))}
							<div className="grid grid-cols-3 gap-1 pt-1.5">
								{Array.from({ length: 6 }, (_, i) => (
									<div
										key={i}
										className="h-3 rounded-sm bg-[color-mix(in_oklab,var(--fa)_18%,transparent)]"
									/>
								))}
							</div>
							{[80, 94, 66].map((w, i) => (
								<div
									key={i}
									className="h-1.5 rounded bg-muted-foreground/25"
									style={{ width: `${w}%` }}
								/>
							))}
						</div>
					)}
					{mode !== "vision" && (
						<div
							className={cn(
								s.scan,
								"absolute inset-x-0 top-0 h-0.5 bg-[var(--fa)] shadow-[0_0_16px_2px_var(--fa)]",
							)}
							style={{ "--scan-h": "14.5rem" } as CSSProperties}
						/>
					)}
				</div>
				<ArrowRight className="mx-auto size-5 rotate-90 text-muted-foreground sm:rotate-0" />
				<pre className="overflow-x-auto rounded-xl border border-border bg-background/85 p-4 font-mono text-[12px] leading-6">
					{output.map((line, i) => (
						<div
							key={i}
							className={cn(
								s.enter,
								line.startsWith("#")
									? "font-semibold text-foreground"
									: "text-muted-foreground",
							)}
							style={stagger(i + 3)}
						>
							{line || " "}
						</div>
					))}
				</pre>
			</div>
		</VisualFrame>
	);
}

function jitter(center: number, random: number, spread: number) {
	const offset = (random - 0.5) * spread;
	return center + offset;
}

function seeded(seed: number) {
	let x = seed;
	return () => {
		const next = x * 9301;
		x = (next + 49297) % 233280;
		return x / 233280;
	};
}

const CLUSTER_COLORS = [
	"var(--fa)",
	"oklch(0.769 0.188 70.08)",
	"oklch(0.645 0.246 16.439)",
];
const CENTERS = [
	{ x: 112, y: 92 },
	{ x: 238, y: 70 },
	{ x: 214, y: 168 },
];

const POINTS = CENTERS.flatMap((center, c) => {
	const rand = seeded(c + 7);
	return Array.from({ length: 10 }, () => ({
		c,
		x: jitter(center.x, rand(), 70),
		y: jitter(center.y, rand(), 56),
	}));
});

const QUERY = { x: 120, y: 98 };
const NEAREST = POINTS.filter((p) => p.c === 0)
	.map((p) => ({ ...p, d: Math.hypot(p.x - QUERY.x, p.y - QUERY.y) }))
	.sort((a, b) => a.d - b.d)
	.slice(0, 3);

export function VectorsVisual({ query, clusters }: Props<"vectors">) {
	return (
		<VisualFrame title="POST /v1/embeddings">
			<div className="mb-3 flex items-center gap-2 rounded-xl border border-border bg-background/85 px-3 py-2.5 font-mono text-[12px]">
				<span className="text-muted-foreground">input:</span>
				<span className="truncate">“{query}”</span>
			</div>
			<svg
				viewBox="0 0 340 220"
				className="h-auto w-full"
				role="img"
				aria-label="Embedding space with three clusters"
			>
				{POINTS.map((p, i) => (
					<circle
						key={i}
						cx={p.x}
						cy={p.y}
						r={4}
						fill={CLUSTER_COLORS[p.c]}
						fillOpacity={0.75}
						className={s.pop}
						style={stagger(i * 0.4)}
					/>
				))}
				{NEAREST.map((p, i) => (
					<line
						key={i}
						x1={QUERY.x}
						y1={QUERY.y}
						x2={p.x}
						y2={p.y}
						pathLength={1}
						stroke="var(--foreground)"
						strokeOpacity={0.55}
						strokeWidth={1.2}
						className={s.draw}
						style={stagger(i + 8)}
					/>
				))}
				<circle
					cx={QUERY.x}
					cy={QUERY.y}
					r={9}
					fill="none"
					stroke="var(--foreground)"
					className={s.pulse}
				/>
				<circle cx={QUERY.x} cy={QUERY.y} r={6} fill="var(--foreground)" />
			</svg>
			<div className="mt-2 flex flex-wrap gap-2">
				{clusters.map((label, i) => (
					<Chip key={label}>
						<span
							className="size-2 rounded-full"
							style={{ background: CLUSTER_COLORS[i] }}
						/>
						{label}
					</Chip>
				))}
			</div>
		</VisualFrame>
	);
}
