"use client";

import {
	ArrowUpDown,
	ArrowUpRight,
	LayoutList,
	Search,
	Star,
	Table as TableIcon,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import {
	FamilyMark,
	GUTTER,
	ModelCard,
} from "@/components/timeline/timeline-parts";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/lib/components/table";
import {
	formatDate,
	formatMonth,
	isoDate,
	type TimelineModel,
} from "@/lib/timeline-data";
import { cn } from "@/lib/utils";

interface MonthGroup {
	key: string;
	label: string;
	items: TimelineModel[];
}

interface TimelineListProps {
	models: TimelineModel[];
	latestReleasedAt: string | null;
}

export function TimelineList({ models, latestReleasedAt }: TimelineListProps) {
	const [query, setQuery] = useState("");
	const [showFlagshipOnly, setShowFlagshipOnly] = useState(false);
	const [sortOrder, setSortOrder] = useState<"newest" | "oldest">("newest");
	const [view, setView] = useState<"timeline" | "table">("timeline");

	const normalizedQuery = query.trim().toLowerCase();

	const filtered = useMemo(() => {
		const list = models.filter((model) => {
			if (showFlagshipOnly && !model.significant) {
				return false;
			}
			if (normalizedQuery) {
				const haystack =
					`${model.name} ${model.id} ${model.family} ${model.providerName}`.toLowerCase();
				if (!haystack.includes(normalizedQuery)) {
					return false;
				}
			}
			return true;
		});

		return [...list].sort((a, b) => {
			const aTime = a.releasedAt ? new Date(a.releasedAt).getTime() : 0;
			const bTime = b.releasedAt ? new Date(b.releasedAt).getTime() : 0;
			return sortOrder === "newest" ? bTime - aTime : aTime - bTime;
		});
	}, [models, normalizedQuery, showFlagshipOnly, sortOrder]);

	const monthGroups = useMemo<MonthGroup[]>(() => {
		const byMonth = new Map<string, MonthGroup>();
		for (const model of filtered) {
			const date = model.releasedAt ? new Date(model.releasedAt) : null;
			const key = date
				? `${date.getUTCFullYear()}-${date.getUTCMonth()}`
				: "undated";
			const label = date
				? `${formatMonth(model.releasedAt)} ${date.getUTCFullYear()}`
				: "Date unknown";
			if (!byMonth.has(key)) {
				byMonth.set(key, { key, label, items: [] });
			}
			byMonth.get(key)!.items.push(model);
		}
		return Array.from(byMonth.values());
	}, [filtered]);

	const hasResults = filtered.length > 0;

	return (
		<div>
			<div className="sticky top-16 z-30 -mx-4 mb-8 border-b border-border/60 bg-background/80 px-4 py-3 backdrop-blur-md">
				<div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
					<label className="relative flex-1 md:max-w-md">
						<span className="sr-only">Search models</span>
						<Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
						<input
							type="search"
							aria-label="Search models, providers, or model IDs"
							placeholder="Search models, providers, IDs…"
							className="w-full rounded-full border border-border bg-background py-2 pl-9 pr-3 text-sm shadow-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary"
							value={query}
							onChange={(e) => setQuery(e.target.value)}
						/>
					</label>

					<div className="flex flex-wrap items-center gap-2">
						<button
							type="button"
							aria-pressed={showFlagshipOnly}
							onClick={() => setShowFlagshipOnly((v) => !v)}
							className={cn(
								"inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
								showFlagshipOnly
									? "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400"
									: "border-border bg-background text-muted-foreground hover:bg-muted",
							)}
						>
							<Star
								className={cn(
									"h-3.5 w-3.5",
									showFlagshipOnly ? "fill-amber-400 text-amber-400" : "",
								)}
							/>
							Flagship
						</button>

						<button
							type="button"
							aria-label={`Sort by ${sortOrder === "newest" ? "oldest" : "newest"} first`}
							onClick={() =>
								setSortOrder((prev) =>
									prev === "newest" ? "oldest" : "newest",
								)
							}
							className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted"
						>
							<ArrowUpDown className="h-3.5 w-3.5" />
							{sortOrder === "newest" ? "Newest" : "Oldest"}
						</button>

						<div className="inline-flex items-center rounded-full border border-border bg-background p-0.5">
							<button
								type="button"
								aria-pressed={view === "timeline"}
								onClick={() => setView("timeline")}
								className={cn(
									"inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors",
									view === "timeline"
										? "bg-primary text-primary-foreground"
										: "text-muted-foreground hover:text-foreground",
								)}
							>
								<LayoutList className="h-3.5 w-3.5" />
								Timeline
							</button>
							<button
								type="button"
								aria-pressed={view === "table"}
								onClick={() => setView("table")}
								className={cn(
									"inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors",
									view === "table"
										? "bg-primary text-primary-foreground"
										: "text-muted-foreground hover:text-foreground",
								)}
							>
								<TableIcon className="h-3.5 w-3.5" />
								Table
							</button>
						</div>
					</div>
				</div>
			</div>

			{!hasResults ? (
				<div className="mx-auto max-w-md py-20 text-center">
					<p className="text-sm text-muted-foreground">
						No models match{" "}
						<span className="font-medium text-foreground">“{query}”</span>. Try
						a different model, provider, or family.
					</p>
				</div>
			) : view === "timeline" ? (
				<div className="relative mx-auto max-w-4xl">
					<div
						aria-hidden
						className={cn(
							"absolute bottom-0 left-0 top-0 flex justify-center",
							GUTTER,
						)}
					>
						<div className="h-full w-px bg-gradient-to-b from-transparent via-border to-transparent" />
					</div>

					<div className="space-y-8">
						{monthGroups.map((month) => (
							<div key={month.key}>
								<div className="mb-3 flex items-center gap-4 md:gap-5">
									<div className={cn("flex shrink-0 justify-center", GUTTER)}>
										<span className="h-1.5 w-1.5 rounded-full bg-sky-400/60 ring-4 ring-background" />
									</div>
									<h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-500 dark:text-sky-400">
										{month.label}
									</h2>
								</div>

								<div className="space-y-3">
									{month.items.map((model) => (
										<div
											key={model.id}
											className="flex items-stretch gap-4 md:gap-5"
										>
											<div
												className={cn(
													"relative flex shrink-0 justify-center pt-6",
													GUTTER,
												)}
											>
												<span
													className={cn(
														"h-2.5 w-2.5 rounded-full ring-4 ring-background",
														model.significant
															? "bg-amber-400"
															: "bg-muted-foreground/40",
													)}
												/>
											</div>
											<div className="flex-1">
												<ModelCard
													model={model}
													latestReleasedAt={latestReleasedAt}
												/>
											</div>
										</div>
									))}
								</div>
							</div>
						))}
					</div>
				</div>
			) : (
				<div className="mx-auto max-w-5xl overflow-hidden rounded-xl border border-border/70">
					<Table>
						<TableHeader>
							<TableRow className="bg-muted/40">
								<TableHead>Model</TableHead>
								<TableHead>Provider</TableHead>
								<TableHead>Provider release</TableHead>
								<TableHead>Added to gateway</TableHead>
								<TableHead className="text-right">Details</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{filtered.map((model) => (
								<TableRow key={model.id}>
									<TableCell>
										<div className="flex items-center gap-2">
											<FamilyMark family={model.family} />
											<div className="min-w-0">
												<div className="font-medium">{model.name}</div>
												<div className="font-mono text-[11px] text-muted-foreground">
													{model.id}
												</div>
											</div>
										</div>
									</TableCell>
									<TableCell className="text-muted-foreground">
										{model.providerName}
									</TableCell>
									<TableCell>
										{model.releasedAt ? (
											<time dateTime={isoDate(model.releasedAt)}>
												{formatDate(model.releasedAt)}
											</time>
										) : (
											<span className="text-muted-foreground">Unknown</span>
										)}
									</TableCell>
									<TableCell>
										{model.addedAt ? (
											<time dateTime={isoDate(model.addedAt)}>
												{formatDate(model.addedAt)}
											</time>
										) : (
											<span className="text-muted-foreground">—</span>
										)}
									</TableCell>
									<TableCell className="text-right">
										<Link
											href={`/models/${encodeURIComponent(model.id)}`}
											className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
										>
											View
											<ArrowUpRight className="h-3 w-3" />
										</Link>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</div>
			)}
		</div>
	);
}
