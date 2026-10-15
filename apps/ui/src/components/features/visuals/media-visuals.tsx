import { ArrowRight, Sparkles } from "lucide-react";
import Image from "next/image";

import { cn } from "@/lib/utils";

import { AudioPlayback, BAR_HEIGHTS } from "./audio-playback";
import { Chip, VisualFrame, stagger } from "./visual-frame";
import s from "./visuals.module.css";

import type { FeatureVisual } from "@/lib/feature-visuals";
import type { CSSProperties } from "react";

type Props<K extends FeatureVisual["kind"]> = Extract<
	FeatureVisual,
	{ kind: K }
>;

function PromptBar({ prompt }: { prompt: string }) {
	return (
		<div className="mb-4 flex items-center gap-2 rounded-xl border border-border bg-background/85 px-3 py-2.5 text-[13px]">
			<Sparkles className="size-4 shrink-0 text-[var(--fa)]" />
			<span className="truncate">{prompt}</span>
			<span className={cn(s.blink, "h-4 w-px shrink-0 bg-foreground")} />
		</div>
	);
}

export function MediaVisual({
	output,
	prompt,
	meta,
	sources,
	poster,
}: Props<"media">) {
	return (
		<VisualFrame
			title={
				output === "image" ? "POST /v1/images/generations" : "POST /v1/videos"
			}
		>
			<PromptBar prompt={prompt} />
			{output === "image" ? (
				<div className="grid grid-cols-2 gap-2.5">
					{sources.map((source, i) => (
						<div
							key={source}
							className={cn(
								s.shimmer,
								"relative aspect-video overflow-hidden rounded-xl bg-muted",
							)}
						>
							<Image
								src={source}
								alt={`${prompt}, generated image ${i + 1}`}
								fill
								sizes="(min-width: 1024px) 22vw, 45vw"
								className={cn(s.revealOnce, "object-cover")}
								style={stagger(i)}
							/>
						</div>
					))}
				</div>
			) : (
				<div
					className={cn(
						s.shimmer,
						"relative aspect-video overflow-hidden rounded-xl bg-muted",
					)}
				>
					<video
						src={sources[0]}
						poster={poster}
						autoPlay
						muted
						loop
						playsInline
						preload="metadata"
						aria-label={prompt}
						className={cn(
							s.revealOnce,
							"absolute inset-0 size-full object-cover",
						)}
					/>
				</div>
			)}
			<div className="mt-4 flex">
				<Chip>{meta}</Chip>
			</div>
		</VisualFrame>
	);
}

function barOpacity(height: number) {
	const scaled = height * 0.55;
	return 0.45 + scaled;
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
			className={cn(
				"flex h-16 min-w-0 flex-1 items-center gap-[3px]",
				className,
			)}
			aria-hidden
		>
			{BAR_HEIGHTS.slice(0, bars).map((h, i) => (
				<span
					key={i}
					className={cn(
						s.wave,
						"min-w-[2px] flex-1 rounded-full bg-[var(--fa)]",
					)}
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

export function AudioVisual({
	mode,
	title,
	words,
	meta,
	src,
	times,
}: Props<"audio">) {
	return (
		<VisualFrame title={title}>
			{mode !== "realtime" && src && times && (
				<AudioPlayback mode={mode} src={src} words={words} times={times} />
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

export function DocumentVisual({
	mode,
	title,
	output,
	image,
}: Props<"document">) {
	return (
		<VisualFrame title={title}>
			<div className="grid items-center gap-4 sm:grid-cols-[0.8fr_auto_1.2fr]">
				<div
					className={cn(
						"relative mx-auto w-full overflow-hidden rounded-lg border border-border bg-background shadow-sm",
						mode === "vision"
							? "aspect-[4/3] max-w-[14rem]"
							: "aspect-[3/4] max-w-[11rem]",
					)}
				>
					{mode === "vision" && image ? (
						<Image
							src={image}
							alt="Image sent to the vision model"
							fill
							sizes="12rem"
							className="object-cover"
						/>
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
					{
						<div
							className={cn(
								s.scan,
								"absolute inset-x-0 top-0 h-0.5 bg-[var(--fa)] shadow-[0_0_16px_2px_var(--fa)]",
							)}
							style={
								{
									"--scan-h": mode === "vision" ? "10.5rem" : "14.5rem",
								} as CSSProperties
							}
						/>
					}
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
