"use client";

import { ArrowUpRight, Search } from "lucide-react";
import { useMemo, useState } from "react";

import { cn } from "@/lib/utils";

import { getAppMetadata, type AppMetadata } from "./app-metadata";

interface AppStat {
	source: string;
	totalTokens: number;
	totalRequests: number;
	lastUsedAt: string | null;
}

interface AppsGridProps {
	apps: AppStat[];
}

interface RankedApp extends AppStat {
	rank: number;
	meta: AppMetadata;
}

const CATEGORIES: Array<{
	value: AppMetadata["category"] | "all";
	label: string;
}> = [
	{ value: "all", label: "All" },
	{ value: "coding", label: "Coding agents" },
	{ value: "automation", label: "Automation" },
	{ value: "other", label: "Other" },
];

const numberFormatter = new Intl.NumberFormat("en-US");

function formatTokens(n: number): string {
	if (n >= 1_000_000_000) {
		return `${(n / 1_000_000_000).toFixed(2)}B`;
	}
	if (n >= 1_000_000) {
		return `${(n / 1_000_000).toFixed(2)}M`;
	}
	if (n >= 1_000) {
		return `${(n / 1_000).toFixed(1)}K`;
	}
	return numberFormatter.format(n);
}

function formatRelative(iso: string | null): string | null {
	if (!iso) {
		return null;
	}
	const then = new Date(iso).getTime();
	const now = Date.now();
	const seconds = Math.floor((now - then) / 1000);
	if (seconds < 60) {
		return "just now";
	}
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) {
		return `${minutes}m ago`;
	}
	const hours = Math.floor(minutes / 60);
	if (hours < 24) {
		return `${hours}h ago`;
	}
	const days = Math.floor(hours / 24);
	if (days < 30) {
		return `${days}d ago`;
	}
	const months = Math.floor(days / 30);
	return `${months}mo ago`;
}

function AppLogo({
	Icon,
	name,
	size = "md",
}: {
	Icon?: React.FC<React.SVGProps<SVGSVGElement>>;
	name: string;
	size?: "sm" | "md" | "lg";
}) {
	const dim =
		size === "lg" ? "h-14 w-14" : size === "sm" ? "h-9 w-9" : "h-12 w-12";
	const iconDim =
		size === "lg" ? "h-8 w-8" : size === "sm" ? "h-5 w-5" : "h-7 w-7";
	if (Icon) {
		return (
			<div
				className={cn(
					"flex items-center justify-center rounded-xl bg-muted text-foreground border border-border/40",
					dim,
				)}
			>
				<Icon className={iconDim} />
			</div>
		);
	}
	const initial = name
		.replace(/^https?:\/\//, "")
		.charAt(0)
		.toUpperCase();
	return (
		<div
			className={cn(
				"flex items-center justify-center rounded-xl bg-muted border border-border/40 font-display font-semibold text-muted-foreground",
				dim,
				size === "lg" ? "text-xl" : "text-base",
			)}
		>
			{initial || "?"}
		</div>
	);
}

function PodiumCard({
	app,
	maxTokens,
	tone,
}: {
	app: RankedApp;
	maxTokens: number;
	tone: "gold" | "silver" | "bronze";
}) {
	const widthPct = maxTokens > 0 ? (app.totalTokens / maxTokens) * 100 : 0;
	const lastUsed = formatRelative(app.lastUsedAt);

	const toneStyles = {
		gold: {
			ring: "ring-blue-500/40 dark:ring-blue-400/30",
			rankColor: "text-blue-500 dark:text-blue-400",
			glow: "bg-blue-500/[0.08] dark:bg-blue-500/[0.06]",
			bar: "bg-blue-500 dark:bg-blue-400",
		},
		silver: {
			ring: "ring-border",
			rankColor: "text-foreground",
			glow: "bg-foreground/[0.04]",
			bar: "bg-foreground",
		},
		bronze: {
			ring: "ring-border",
			rankColor: "text-foreground",
			glow: "bg-foreground/[0.03]",
			bar: "bg-foreground",
		},
	}[tone];

	const Wrap = app.meta.url ? "a" : "div";
	const wrapProps = app.meta.url
		? {
				href: app.meta.url,
				target: "_blank" as const,
				rel: "noopener noreferrer",
			}
		: {};

	return (
		<Wrap
			{...wrapProps}
			className={cn(
				"group relative block overflow-hidden rounded-2xl border bg-card p-6 ring-1 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-xl",
				toneStyles.ring,
			)}
		>
			<div
				aria-hidden
				className={cn(
					"pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full blur-3xl",
					toneStyles.glow,
				)}
			/>

			<div className="relative space-y-5">
				<div className="flex items-start justify-between gap-4">
					<div className="flex items-center gap-4">
						<AppLogo
							Icon={app.meta.Icon}
							name={app.meta.displayName}
							size="lg"
						/>
						<div className="min-w-0">
							<h3 className="font-display text-xl font-bold tracking-tight">
								{app.meta.displayName}
							</h3>
							<p className="font-mono text-xs text-muted-foreground truncate">
								{app.source}
							</p>
						</div>
					</div>
					<div className="flex flex-col items-end">
						<span
							className={cn(
								"font-display text-5xl font-bold leading-none tracking-tighter tabular-nums",
								toneStyles.rankColor,
							)}
						>
							{String(app.rank).padStart(2, "0")}
						</span>
						<ArrowUpRight className="mt-1 h-4 w-4 text-muted-foreground transition-all group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-foreground" />
					</div>
				</div>

				<p className="text-sm text-muted-foreground leading-relaxed line-clamp-2 min-h-[2.5rem]">
					{app.meta.description}
				</p>

				<div className="space-y-2 pt-2">
					<div className="flex items-baseline justify-between">
						<span className="font-display text-3xl font-bold tracking-tight tabular-nums">
							{formatTokens(app.totalTokens)}
						</span>
						<span className="text-[10px] uppercase tracking-widest text-muted-foreground">
							tokens processed
						</span>
					</div>
					<div className="h-2 w-full overflow-hidden rounded-full bg-muted">
						<div
							className={cn(
								"h-full rounded-full transition-all duration-700 ease-out",
								toneStyles.bar,
							)}
							style={{ width: `${Math.max(2, widthPct)}%` }}
						/>
					</div>
					<div className="flex items-center justify-between text-xs text-muted-foreground">
						<span>{numberFormatter.format(app.totalRequests)} requests</span>
						{lastUsed && (
							<span className="flex items-center gap-1.5">
								<span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
								last seen {lastUsed}
							</span>
						)}
					</div>
				</div>
			</div>
		</Wrap>
	);
}

function GridCard({ app, maxTokens }: { app: RankedApp; maxTokens: number }) {
	const widthPct = maxTokens > 0 ? (app.totalTokens / maxTokens) * 100 : 0;
	const lastUsed = formatRelative(app.lastUsedAt);

	const Wrap = app.meta.url ? "a" : "div";
	const wrapProps = app.meta.url
		? {
				href: app.meta.url,
				target: "_blank" as const,
				rel: "noopener noreferrer",
			}
		: {};

	return (
		<Wrap
			{...wrapProps}
			className="group relative block rounded-xl border bg-card p-5 transition-all hover:-translate-y-0.5 hover:border-foreground/30 hover:shadow-md"
		>
			<div className="flex items-start justify-between gap-3">
				<div className="flex min-w-0 items-center gap-3">
					<AppLogo Icon={app.meta.Icon} name={app.meta.displayName} />
					<div className="min-w-0">
						<h3 className="font-display text-base font-semibold tracking-tight truncate">
							{app.meta.displayName}
						</h3>
						<p className="font-mono text-[11px] text-muted-foreground truncate">
							{app.source}
						</p>
					</div>
				</div>
				<span className="font-display text-2xl font-bold leading-none tracking-tighter tabular-nums text-muted-foreground/60">
					{String(app.rank).padStart(2, "0")}
				</span>
			</div>

			<div className="mt-4 space-y-2">
				<div className="flex items-baseline justify-between">
					<span className="font-display text-2xl font-bold tracking-tight tabular-nums">
						{formatTokens(app.totalTokens)}
					</span>
					<span className="text-[10px] uppercase tracking-widest text-muted-foreground">
						tokens
					</span>
				</div>
				<div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
					<div
						className="h-full rounded-full bg-foreground/80 transition-all duration-700"
						style={{ width: `${Math.max(2, widthPct)}%` }}
					/>
				</div>
				<div className="flex items-center justify-between text-[11px] text-muted-foreground">
					<span>{numberFormatter.format(app.totalRequests)} requests</span>
					{lastUsed && <span>{lastUsed}</span>}
				</div>
			</div>
		</Wrap>
	);
}

function ListRow({ app, maxTokens }: { app: RankedApp; maxTokens: number }) {
	const widthPct = maxTokens > 0 ? (app.totalTokens / maxTokens) * 100 : 0;
	const lastUsed = formatRelative(app.lastUsedAt);

	const Wrap = app.meta.url ? "a" : "div";
	const wrapProps = app.meta.url
		? {
				href: app.meta.url,
				target: "_blank" as const,
				rel: "noopener noreferrer",
			}
		: {};

	return (
		<Wrap
			{...wrapProps}
			className="group grid grid-cols-[3rem_minmax(0,1fr)_minmax(0,1.5fr)_auto] items-center gap-4 border-b border-border/60 px-2 py-4 transition-colors hover:bg-muted/40 last:border-b-0 sm:grid-cols-[3rem_minmax(0,1fr)_minmax(0,2fr)_8rem_5rem]"
		>
			<span className="font-display text-xl font-bold tabular-nums text-muted-foreground/70 tracking-tighter">
				{String(app.rank).padStart(2, "0")}
			</span>
			<div className="flex min-w-0 items-center gap-3">
				<AppLogo Icon={app.meta.Icon} name={app.meta.displayName} size="sm" />
				<div className="min-w-0">
					<p className="font-display text-sm font-semibold truncate">
						{app.meta.displayName}
					</p>
					<p className="font-mono text-[10px] text-muted-foreground truncate">
						{app.source}
					</p>
				</div>
			</div>
			<div className="hidden items-center gap-3 sm:flex">
				<span className="font-display text-base font-semibold tabular-nums whitespace-nowrap">
					{formatTokens(app.totalTokens)}
				</span>
				<div className="h-1 w-full overflow-hidden rounded-full bg-muted">
					<div
						className="h-full rounded-full bg-foreground/70"
						style={{ width: `${Math.max(2, widthPct)}%` }}
					/>
				</div>
			</div>
			<div className="hidden text-right text-xs text-muted-foreground tabular-nums sm:block">
				{numberFormatter.format(app.totalRequests)}
			</div>
			<div className="text-right text-xs text-muted-foreground">
				{lastUsed ?? "—"}
			</div>
		</Wrap>
	);
}

export function AppsGrid({ apps }: AppsGridProps) {
	const [query, setQuery] = useState("");
	const [category, setCategory] = useState<AppMetadata["category"] | "all">(
		"all",
	);

	const ranked: RankedApp[] = useMemo(
		() =>
			apps.map((a, idx) => ({
				...a,
				rank: idx + 1,
				meta: getAppMetadata(a.source),
			})),
		[apps],
	);

	const filtered = useMemo(() => {
		const needle = query.trim().toLowerCase();
		return ranked.filter((a) => {
			if (category !== "all" && a.meta.category !== category) {
				return false;
			}
			if (!needle) {
				return true;
			}
			return (
				a.source.toLowerCase().includes(needle) ||
				a.meta.displayName.toLowerCase().includes(needle)
			);
		});
	}, [ranked, query, category]);

	const maxTokens = ranked[0]?.totalTokens ?? 0;

	const isFiltered = filtered.length !== ranked.length;
	const podium = isFiltered ? [] : filtered.slice(0, 3);
	const gridApps = isFiltered ? filtered.slice(0, 12) : filtered.slice(3, 12);
	const listApps = isFiltered ? filtered.slice(12) : filtered.slice(12);

	return (
		<div className="space-y-12">
			<div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
				<div className="relative flex-1 max-w-md">
					<Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
					<input
						type="text"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder="Search apps…"
						className="h-11 w-full rounded-full border bg-background pl-10 pr-4 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-foreground/40 focus:ring-2 focus:ring-foreground/10"
					/>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					{CATEGORIES.map((c) => (
						<button
							key={c.value}
							type="button"
							onClick={() => setCategory(c.value)}
							className={cn(
								"rounded-full border px-4 py-1.5 text-sm transition-all",
								category === c.value
									? "border-foreground bg-foreground text-background"
									: "border-border bg-background text-muted-foreground hover:border-foreground/40 hover:text-foreground",
							)}
						>
							{c.label}
						</button>
					))}
				</div>
			</div>

			{filtered.length === 0 ? (
				<div className="rounded-2xl border border-dashed py-24 text-center">
					<p className="font-display text-lg font-semibold">No apps found</p>
					<p className="mt-1 text-sm text-muted-foreground">
						Try a different search or filter.
					</p>
				</div>
			) : (
				<>
					{podium.length === 3 && (
						<section className="space-y-4">
							<div className="flex items-baseline justify-between">
								<h2 className="font-display text-2xl font-bold tracking-tight">
									The leaderboard
								</h2>
								<span className="text-xs uppercase tracking-widest text-muted-foreground">
									Top 3 by tokens processed
								</span>
							</div>
							<div className="grid gap-5 lg:grid-cols-12">
								<div className="lg:col-span-6">
									<PodiumCard
										app={podium[0]!}
										maxTokens={maxTokens}
										tone="gold"
									/>
								</div>
								<div className="lg:col-span-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-1">
									<PodiumCard
										app={podium[1]!}
										maxTokens={maxTokens}
										tone="silver"
									/>
									<PodiumCard
										app={podium[2]!}
										maxTokens={maxTokens}
										tone="bronze"
									/>
								</div>
							</div>
						</section>
					)}

					{gridApps.length > 0 && (
						<section className="space-y-4">
							<h2 className="font-display text-xl font-semibold tracking-tight text-muted-foreground">
								{isFiltered ? "Results" : "More apps"}
							</h2>
							<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
								{gridApps.map((app) => (
									<GridCard key={app.source} app={app} maxTokens={maxTokens} />
								))}
							</div>
						</section>
					)}

					{listApps.length > 0 && (
						<section className="space-y-4">
							<h2 className="font-display text-xl font-semibold tracking-tight text-muted-foreground">
								The long tail
							</h2>
							<div className="rounded-2xl border bg-card overflow-hidden">
								<div className="hidden grid-cols-[3rem_minmax(0,1fr)_minmax(0,2fr)_8rem_5rem] gap-4 border-b bg-muted/30 px-2 py-3 text-[10px] font-medium uppercase tracking-widest text-muted-foreground sm:grid">
									<span>#</span>
									<span>App</span>
									<span>Tokens</span>
									<span className="text-right">Requests</span>
									<span className="text-right">Last seen</span>
								</div>
								{listApps.map((app) => (
									<ListRow key={app.source} app={app} maxTokens={maxTokens} />
								))}
							</div>
						</section>
					)}
				</>
			)}
		</div>
	);
}
