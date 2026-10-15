import {
	AlertTriangle,
	ArrowRight,
	CheckCircle2,
	Info,
	Search,
	Sparkles,
	Wallet,
	XCircle,
} from "lucide-react";

import { cn } from "@/lib/utils";

import { Chip, VisualFrame, stagger } from "./visual-frame";
import s from "./visuals.module.css";

import type { FeatureVisual, FeedTone } from "@/lib/feature-visuals";
import type { CSSProperties } from "react";

type Props<K extends FeatureVisual["kind"]> = Extract<
	FeatureVisual,
	{ kind: K }
>;

export function ResponseVisual({ title, lines, footer }: Props<"response">) {
	return (
		<VisualFrame title={title}>
			<div className="overflow-x-auto">
				<pre className="min-w-max font-mono text-[12px] leading-6 sm:text-[12.5px]">
					{lines.map((line, i) => (
						<div
							key={i}
							style={stagger(i)}
							className={cn(
								s.enter,
								"whitespace-pre rounded-md border-l-2 px-3",
								line.highlight
									? "border-[var(--fa)] bg-[color-mix(in_oklab,var(--fa)_13%,transparent)] text-foreground"
									: "border-transparent text-muted-foreground",
							)}
						>
							{line.text || " "}
						</div>
					))}
				</pre>
			</div>
			{footer && (
				<div className="mt-4 flex">
					<Chip className={s.enter} style={stagger(lines.length)}>
						<Sparkles className="size-3 text-[var(--fa)]" />
						{footer}
					</Chip>
				</div>
			)}
		</VisualFrame>
	);
}

export function HealVisual({ broken, fixed }: Props<"heal">) {
	return (
		<VisualFrame title="response_format: json_schema">
			<div className="grid items-center gap-4 sm:grid-cols-[1fr_auto_1fr]">
				<div className="relative overflow-hidden rounded-xl border border-dashed border-rose-500/40 bg-background/80 p-4">
					<p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-rose-500">
						Model output
					</p>
					<pre className="font-mono text-[12px] leading-6 text-muted-foreground">
						{broken.map((line, i) => (
							<div
								key={i}
								className={cn(
									i === broken.length - 1 &&
										"underline decoration-rose-500 decoration-wavy underline-offset-4",
								)}
							>
								{line}
							</div>
						))}
					</pre>
					<div
						className={cn(
							s.healScan,
							"pointer-events-none absolute inset-y-0 left-0 w-full bg-gradient-to-r from-transparent via-[color-mix(in_oklab,var(--fa)_25%,transparent)] to-transparent",
						)}
					/>
				</div>
				<ArrowRight className="mx-auto size-5 rotate-90 text-muted-foreground sm:rotate-0" />
				<div className="rounded-xl border border-[color-mix(in_oklab,var(--fa)_45%,transparent)] bg-background/80 p-4">
					<p className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-[var(--fa)]">
						<CheckCircle2 className="size-3.5" />
						Valid JSON
					</p>
					<pre className={cn(s.heal, "font-mono text-[12px] leading-6")}>
						{fixed.map((line, i) => (
							<div key={i}>{line}</div>
						))}
					</pre>
				</div>
			</div>
		</VisualFrame>
	);
}

const TONE_BAR = {
	accent: "bg-[var(--fa)]",
	muted: "bg-muted-foreground/35",
	warn: "bg-rose-500",
} as const;

export function RankingVisual({ title, query, items }: Props<"ranking">) {
	return (
		<VisualFrame title={title}>
			{query && (
				<div className="mb-5 flex items-center gap-2 rounded-xl border border-border bg-background/80 px-3 py-2.5 text-sm">
					<Search className="size-4 shrink-0 text-muted-foreground" />
					<span className="truncate">{query}</span>
					<span className={cn(s.blink, "h-4 w-px shrink-0 bg-foreground")} />
				</div>
			)}
			<ol className="space-y-3.5">
				{items.map((item, i) => (
					<li
						key={item.label}
						className={cn(
							s.enter,
							"grid grid-cols-[1.25rem_1fr_auto] items-center gap-3",
						)}
						style={stagger(i)}
					>
						<span className="font-mono text-[11px] text-muted-foreground">
							{i + 1}
						</span>
						<div className="min-w-0">
							<p className="mb-1.5 truncate text-[13px] font-medium">
								{item.label}
							</p>
							<div className="h-1.5 overflow-hidden rounded-full bg-muted">
								<div
									className={cn(
										s.grow,
										"h-full rounded-full",
										TONE_BAR[item.tone ?? "accent"],
									)}
									style={{
										...stagger(i),
										width: `${Math.max(4, Math.min(100, item.value * 100))}%`,
									}}
								/>
							</div>
						</div>
						<span className="font-mono text-xs tabular-nums text-muted-foreground">
							{item.display}
						</span>
					</li>
				))}
			</ol>
		</VisualFrame>
	);
}

const TONE_ICON: Record<FeedTone, { icon: typeof Info; className: string }> = {
	ok: { icon: CheckCircle2, className: "text-emerald-500" },
	info: { icon: Info, className: "text-[var(--fa)]" },
	warn: { icon: AlertTriangle, className: "text-amber-500" },
	error: { icon: XCircle, className: "text-rose-500" },
};

export function FeedVisual({ title, items }: Props<"feed">) {
	return (
		<VisualFrame title={title}>
			<div className="mb-4 flex items-center gap-2 text-xs text-muted-foreground">
				<span className="relative flex size-2">
					<span className="absolute inset-0 animate-ping rounded-full bg-emerald-500/60 motion-reduce:animate-none" />
					<span className="relative size-2 rounded-full bg-emerald-500" />
				</span>
				Live
			</div>
			<ul className="space-y-2.5">
				{items.map((item, i) => {
					const tone = TONE_ICON[item.tone];
					const Icon = tone.icon;
					return (
						<li
							key={item.title}
							style={stagger(i * 1.6)}
							className={cn(
								s.enter,
								"flex items-center gap-3 rounded-xl border border-border bg-background/85 px-3.5 py-3 shadow-xs",
							)}
						>
							<Icon className={cn("size-4 shrink-0", tone.className)} />
							<span className="min-w-0 flex-1 truncate text-[13px] font-medium">
								{item.title}
							</span>
							<span className="shrink-0 font-mono text-[11px] text-muted-foreground">
								{item.meta}
							</span>
						</li>
					);
				})}
			</ul>
		</VisualFrame>
	);
}

export function VersionsVisual({ name, versions, labels }: Props<"versions">) {
	const count = versions.length;
	return (
		<VisualFrame title={name}>
			<div className="relative pt-12">
				{labels.map((label, i) => (
					<div
						key={label.name}
						className="absolute top-0 flex justify-center"
						style={{
							left: `${(label.from / count) * 100}%`,
							width: `${100 / count}%`,
						}}
					>
						<div
							className={cn(s.label, "flex justify-center")}
							style={
								{
									"--shift": `${(label.to - label.from) * 100}%`,
									width: "100%",
								} as CSSProperties
							}
						>
							<span
								className={cn(
									"rounded-full px-2.5 py-1 font-mono text-[11px] font-medium",
									i === 0
										? "bg-[var(--fa)] text-white dark:text-zinc-950"
										: "border border-border bg-background text-muted-foreground",
								)}
							>
								{label.name}
							</span>
						</div>
					</div>
				))}
				<div
					className="relative grid"
					style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}
				>
					<div className="absolute left-[12%] right-[12%] top-[11px] h-px bg-border" />
					{versions.map((version, i) => (
						<div
							key={version.id}
							className={cn(
								s.pop,
								"relative flex flex-col items-center gap-2 text-center",
							)}
							style={stagger(i)}
						>
							<span className="flex size-6 items-center justify-center rounded-full border border-border bg-background">
								<span className="size-2 rounded-full bg-[var(--fa)]" />
							</span>
							<span className="font-mono text-xs font-semibold">
								{version.id}
							</span>
							<span className="max-w-[9rem] text-[11px] leading-snug text-muted-foreground">
								{version.note}
							</span>
						</div>
					))}
				</div>
			</div>
		</VisualFrame>
	);
}

export function TreeVisual({ root, branches }: Props<"tree">) {
	return (
		<VisualFrame title={root}>
			<div className="flex flex-col items-center">
				<div
					className={cn(
						s.pop,
						"rounded-xl border border-[color-mix(in_oklab,var(--fa)_50%,transparent)] bg-background px-4 py-2 text-sm font-semibold",
					)}
				>
					{root}
				</div>
				<div className="h-5 w-px bg-border" />
				<div
					className="grid w-full gap-3 border-t border-border pt-5"
					style={{
						gridTemplateColumns: `repeat(${Math.min(branches.length, 3)}, minmax(0, 1fr))`,
					}}
				>
					{branches.map((branch, i) => (
						<div
							key={branch.label}
							className={cn(
								s.enter,
								"rounded-xl border border-border bg-background/85 p-3",
							)}
							style={stagger(i + 1)}
						>
							<div className="mb-2.5 flex flex-wrap items-center justify-between gap-1.5">
								<span className="text-[13px] font-semibold">
									{branch.label}
								</span>
								{branch.badge && (
									<span className="rounded-full bg-[color-mix(in_oklab,var(--fa)_15%,transparent)] px-2 py-0.5 font-mono text-[10px] text-[var(--fa)]">
										{branch.badge}
									</span>
								)}
							</div>
							<div className="flex flex-wrap gap-1.5">
								{branch.children.map((child, j) => (
									<span
										key={child}
										className={cn(
											s.pop,
											"rounded-md bg-muted px-2 py-1 font-mono text-[10.5px] text-muted-foreground",
										)}
										style={stagger(i + i + j + 2)}
									>
										{child}
									</span>
								))}
							</div>
						</div>
					))}
				</div>
			</div>
		</VisualFrame>
	);
}

export function CheckoutVisual({
	brand,
	balance,
	packs,
	charges,
	margin,
}: Props<"checkout">) {
	return (
		<VisualFrame title={`${brand} · wallet`}>
			<div className="grid gap-4 sm:grid-cols-[1.1fr_1fr]">
				<div
					className={cn(
						s.enter,
						"rounded-xl border border-border bg-background/85 p-4",
					)}
				>
					<div className="flex items-center gap-2 text-xs text-muted-foreground">
						<Wallet className="size-3.5" />
						Credit balance
					</div>
					<p className="mt-1 font-display text-3xl font-bold tabular-nums">
						{balance}
					</p>
					<div className="mt-4 grid grid-cols-3 gap-2">
						{packs.map((pack, i) => (
							<span
								key={pack}
								className={cn(
									s.lift,
									"rounded-lg border px-2 py-2 text-center text-xs font-medium",
									i === 1
										? "border-[var(--fa)] bg-[color-mix(in_oklab,var(--fa)_12%,transparent)] text-foreground"
										: "border-border text-muted-foreground",
								)}
							>
								{pack}
							</span>
						))}
					</div>
					<div className="mt-3 rounded-lg bg-foreground py-2 text-center text-xs font-semibold text-background">
						Buy credits
					</div>
				</div>
				<div className="flex flex-col gap-3">
					<div
						className={cn(
							s.enter,
							"relative h-[7.5rem] overflow-hidden rounded-xl border border-border bg-background/85 p-4",
						)}
						style={stagger(1)}
					>
						<p className="mb-2 text-xs text-muted-foreground">
							Pay per request
						</p>
						{charges.map((charge, i) => (
							<p
								key={charge}
								className={cn(
									s.tick,
									i === 0 && s.tickLead,
									"absolute inset-x-4 top-10 font-mono text-[12px]",
								)}
								style={stagger(i)}
							>
								{charge}
							</p>
						))}
					</div>
					<div
						className={cn(
							s.enter,
							"rounded-xl border border-border bg-background/85 p-4",
						)}
						style={stagger(2)}
					>
						<p className="mb-2 text-xs text-muted-foreground">Every charge</p>
						<div className="flex h-2 overflow-hidden rounded-full bg-muted">
							<div
								className={cn(s.grow, "h-full bg-muted-foreground/45")}
								style={{ width: `${100 - margin}%` }}
							/>
							<div
								className={cn(s.grow, "h-full bg-[var(--fa)]")}
								style={{ ...stagger(3), width: `${margin}%` }}
							/>
						</div>
						<div className="mt-2 flex justify-between text-[11px] text-muted-foreground">
							<span>Model cost</span>
							<span className="text-[var(--fa)]">Your markup</span>
						</div>
					</div>
				</div>
			</div>
		</VisualFrame>
	);
}
