"use client";

import {
	ArrowRight,
	ArrowUpDown,
	ArrowUpRight,
	LayoutList,
	Search,
	Sparkles,
	Star,
	Table as TableIcon,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import Footer from "@/components/landing/footer";
import { Navbar } from "@/components/landing/navbar";
import { Badge } from "@/lib/components/badge";
import { Button } from "@/lib/components/button";
import { Card, CardContent, CardHeader } from "@/lib/components/card";
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
	type TimelineFaq,
	type TimelineModel,
	type TimelineStats,
} from "@/lib/timeline-data";
import { cn } from "@/lib/utils";

import { getModelFamilyIcon } from "@llmgateway/shared/components";

interface MonthGroup {
	key: string;
	label: string;
	items: TimelineModel[];
}

interface YearGroup {
	year: string;
	count: number;
	months: MonthGroup[];
}

interface TimelineClientProps {
	models: TimelineModel[];
	stats: TimelineStats;
	faqs: TimelineFaq[];
}

const GUTTER = "w-10 md:w-14";

function FamilyMark({ family }: { family: string }) {
	const Icon = getModelFamilyIcon(family);
	return (
		<span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-muted/50">
			<Icon className="h-5 w-5" />
		</span>
	);
}

function ModelFact({ model }: { model: TimelineModel }) {
	return (
		<p className="text-sm leading-relaxed text-muted-foreground">
			<span className="font-medium text-foreground">{model.name}</span> was
			{model.releasedAt ? " released by " : " added by "}
			<span className="font-medium text-foreground">{model.providerName}</span>
			{model.releasedAt ? (
				<>
					{" "}
					on{" "}
					<time
						dateTime={isoDate(model.releasedAt)}
						className="font-medium text-foreground"
					>
						{formatDate(model.releasedAt)}
					</time>
				</>
			) : null}
			{model.addedAt ? (
				<>
					{model.releasedAt ? " and added" : ""} to LLM Gateway on{" "}
					<time
						dateTime={isoDate(model.addedAt)}
						className="font-medium text-foreground"
					>
						{formatDate(model.addedAt)}
					</time>
				</>
			) : null}
			.
		</p>
	);
}

export function TimelineClient({ models, stats, faqs }: TimelineClientProps) {
	const [query, setQuery] = useState("");
	const [showFlagshipOnly, setShowFlagshipOnly] = useState(false);
	const [sortOrder, setSortOrder] = useState<"newest" | "oldest">("newest");
	const [view, setView] = useState<"timeline" | "table">("timeline");
	const [activeYear, setActiveYear] = useState<string>("");
	const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

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

	const yearGroups = useMemo<YearGroup[]>(() => {
		const byYear = new Map<string, Map<string, MonthGroup>>();

		for (const model of filtered) {
			const date = model.releasedAt ? new Date(model.releasedAt) : null;
			const year = date ? String(date.getUTCFullYear()) : "Undated";
			const monthKey = date
				? `${date.getUTCFullYear()}-${date.getUTCMonth()}`
				: "undated";
			const monthLabel = date ? formatMonth(model.releasedAt) : "Date unknown";

			if (!byYear.has(year)) {
				byYear.set(year, new Map());
			}
			const months = byYear.get(year)!;
			if (!months.has(monthKey)) {
				months.set(monthKey, { key: monthKey, label: monthLabel, items: [] });
			}
			months.get(monthKey)!.items.push(model);
		}

		const groups: YearGroup[] = [];
		for (const [year, months] of Array.from(byYear.entries())) {
			const monthList = Array.from(months.values());
			groups.push({
				year,
				count: monthList.reduce((sum, m) => sum + m.items.length, 0),
				months: monthList,
			});
		}

		groups.sort((a, b) => {
			if (a.year === "Undated") {
				return 1;
			}
			if (b.year === "Undated") {
				return -1;
			}
			return sortOrder === "newest"
				? Number(b.year) - Number(a.year)
				: Number(a.year) - Number(b.year);
		});

		return groups;
	}, [filtered, sortOrder]);

	const years = useMemo(
		() => yearGroups.map((g) => g.year).filter((y) => y !== "Undated"),
		[yearGroups],
	);

	useEffect(() => {
		if (view !== "timeline" || years.length === 0) {
			return;
		}
		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (entry.isIntersecting) {
						setActiveYear(entry.target.id.replace("year-", ""));
					}
				}
			},
			{ rootMargin: "-30% 0px -60% 0px", threshold: 0 },
		);
		for (const year of years) {
			const el = sectionRefs.current[year];
			if (el) {
				observer.observe(el);
			}
		}
		return () => observer.disconnect();
	}, [years, view]);

	const hasResults = filtered.length > 0;

	return (
		<>
			<Navbar />

			<main className="relative min-h-screen overflow-hidden bg-background pt-20 md:pt-24">
				{/* Ambient backdrop glow */}
				<div
					aria-hidden
					className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[480px] bg-[radial-gradient(60%_60%_at_50%_0%,rgba(56,189,248,0.12)_0%,transparent_70%)]"
				/>

				{/* Hero */}
				<section className="border-b border-border/60">
					<div className="container mx-auto px-4 py-12 md:py-16">
						<div className="mx-auto max-w-3xl space-y-5 text-center">
							<Badge
								variant="outline"
								className="gap-1.5 rounded-full px-3 py-1 text-xs"
							>
								<Sparkles className="h-3.5 w-3.5 text-sky-400" />
								Model release timeline
							</Badge>
							<h1 className="font-display text-3xl font-bold tracking-tight text-balance md:text-5xl">
								When every LLM was released
							</h1>
							<p className="mx-auto max-w-2xl text-balance text-sm text-muted-foreground md:text-base">
								A continuously updated timeline of large language model releases
								— when each model shipped from its provider and when it landed
								on LLM Gateway. Track GPT, Claude, Gemini, Llama, Mistral,
								DeepSeek and more in one place.
							</p>

							{/* Stat chips — freshness + scale signals */}
							<dl className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3 pt-2 text-sm">
								<div className="flex items-baseline gap-1.5">
									<dd className="font-display text-xl font-bold tabular-nums text-foreground">
										{stats.totalModels}
									</dd>
									<dt className="text-muted-foreground">models</dt>
								</div>
								<span aria-hidden className="text-border">
									•
								</span>
								<div className="flex items-baseline gap-1.5">
									<dd className="font-display text-xl font-bold tabular-nums text-foreground">
										{stats.totalProviders}
									</dd>
									<dt className="text-muted-foreground">providers</dt>
								</div>
								{stats.firstYear ? (
									<>
										<span aria-hidden className="text-border">
											•
										</span>
										<div className="flex items-baseline gap-1.5">
											<dd className="text-muted-foreground">since</dd>
											<dt className="font-display text-xl font-bold tabular-nums text-foreground">
												{stats.firstYear}
											</dt>
										</div>
									</>
								) : null}
								{stats.latestReleasedAt ? (
									<>
										<span aria-hidden className="text-border">
											•
										</span>
										<div className="flex items-center gap-1.5">
											<span className="relative flex h-2 w-2">
												<span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/70" />
												<span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
											</span>
											<span className="text-muted-foreground">
												Updated{" "}
												<time
													dateTime={isoDate(stats.latestReleasedAt)}
													className="font-medium text-foreground"
												>
													{formatDate(stats.latestReleasedAt)}
												</time>
											</span>
										</div>
									</>
								) : null}
							</dl>
						</div>
					</div>
				</section>

				{/* Sticky control bar */}
				<div className="sticky top-16 z-30 border-b border-border/60 bg-background/80 backdrop-blur-md">
					<div className="container mx-auto space-y-3 px-4 py-3">
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

						{/* Year quick-nav */}
						{view === "timeline" && years.length > 1 ? (
							<nav aria-label="Jump to year" className="flex flex-wrap gap-1.5">
								{years.map((year) => (
									<a
										key={year}
										href={`#year-${year}`}
										aria-current={activeYear === year ? "true" : undefined}
										className={cn(
											"rounded-full border px-3 py-1 text-xs font-medium tabular-nums transition-colors",
											activeYear === year
												? "border-transparent bg-primary text-primary-foreground"
												: "border-border bg-background text-muted-foreground hover:bg-muted",
										)}
									>
										{year}
									</a>
								))}
							</nav>
						) : null}
					</div>
				</div>

				{/* Body */}
				<section className="container mx-auto px-4 py-10 md:py-14">
					{!hasResults ? (
						<div className="mx-auto max-w-md py-20 text-center">
							<p className="text-sm text-muted-foreground">
								No models match{" "}
								<span className="font-medium text-foreground">“{query}”</span>.
								Try a different model, provider, or family.
							</p>
						</div>
					) : view === "timeline" ? (
						<div className="relative mx-auto max-w-4xl">
							{/* Continuous rail */}
							<div
								aria-hidden
								className={cn(
									"absolute bottom-0 left-0 top-0 flex justify-center",
									GUTTER,
								)}
							>
								<div className="h-full w-px bg-gradient-to-b from-transparent via-border to-transparent" />
							</div>

							<div className="space-y-14">
								{yearGroups.map((group) => (
									<section
										key={group.year}
										id={`year-${group.year}`}
										ref={(el) => {
											sectionRefs.current[group.year] = el;
										}}
										className="scroll-mt-36"
									>
										{/* Year marker */}
										<div className="mb-8 flex items-center gap-4 md:gap-5">
											<div
												className={cn(
													"relative z-10 flex aspect-square shrink-0 items-center justify-center rounded-full border border-border bg-background shadow-sm",
													GUTTER,
												)}
											>
												<h2 className="font-display text-xs font-bold tabular-nums md:text-sm">
													{group.year === "Undated" ? "—" : group.year}
												</h2>
											</div>
											<p className="text-sm text-muted-foreground">
												<span className="font-medium text-foreground">
													{group.count}
												</span>{" "}
												{group.count === 1 ? "model" : "models"}
												{group.year !== "Undated" ? ` in ${group.year}` : ""}
											</p>
										</div>

										<div className="space-y-8">
											{group.months.map((month) => (
												<div key={month.key}>
													<div className="mb-3 flex items-center gap-4 md:gap-5">
														<div
															className={cn(
																"flex shrink-0 justify-center",
																GUTTER,
															)}
														>
															<span className="h-1.5 w-1.5 rounded-full bg-sky-400/60 ring-4 ring-background" />
														</div>
														<h3 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-500 dark:text-sky-400">
															{month.label}
															{group.year !== "Undated" ? ` ${group.year}` : ""}
														</h3>
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

																<Card className="group flex-1 gap-0 border-border/70 bg-card/60 py-4 backdrop-blur transition-all hover:border-primary/40 hover:bg-card hover:shadow-md">
																	<CardHeader className="px-4 pb-2">
																		<div className="flex items-start gap-3">
																			<FamilyMark family={model.family} />
																			<div className="min-w-0 flex-1">
																				<div className="flex flex-wrap items-center gap-2">
																					<h4 className="font-display text-base font-semibold leading-tight md:text-lg">
																						{model.name}
																					</h4>
																					{model.significant ? (
																						<Badge
																							variant="outline"
																							className="border-amber-500/40 bg-amber-500/10 px-1.5 py-0 text-[10px] font-medium text-amber-600 dark:text-amber-400"
																						>
																							Flagship
																						</Badge>
																					) : null}
																					{model.releasedAt ===
																					stats.latestReleasedAt ? (
																						<Badge
																							variant="outline"
																							className="border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0 text-[10px] font-medium text-emerald-600 dark:text-emerald-400"
																						>
																							Latest
																						</Badge>
																					) : null}
																				</div>
																				<p className="mt-0.5 text-xs text-muted-foreground">
																					{model.providerName} ·{" "}
																					<span className="font-mono text-[11px]">
																						{model.id}
																					</span>
																				</p>
																			</div>
																		</div>
																	</CardHeader>
																	<CardContent className="px-4">
																		<ModelFact model={model} />
																		<Button
																			asChild
																			variant="ghost"
																			size="sm"
																			className="mt-2 h-auto px-0 text-primary hover:bg-transparent hover:text-primary hover:underline"
																		>
																			<Link
																				href={`/models/${encodeURIComponent(model.id)}`}
																				className="inline-flex items-center gap-1 text-xs font-medium"
																			>
																				View model details
																				<ArrowUpRight className="h-3 w-3" />
																			</Link>
																		</Button>
																	</CardContent>
																</Card>
															</div>
														))}
													</div>
												</div>
											))}
										</div>
									</section>
								))}
							</div>
						</div>
					) : (
						/* Table view — extra-extractable semantic data */
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
				</section>

				{/* FAQ */}
				<section
					id="faq"
					className="border-t border-border/60 bg-muted/20"
					aria-labelledby="timeline-faq-heading"
				>
					<div className="container mx-auto max-w-3xl px-4 py-14 md:py-20">
						<div className="mb-8 text-center">
							<p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
								FAQ
							</p>
							<h2
								id="timeline-faq-heading"
								className="font-display text-2xl font-bold tracking-tight md:text-3xl"
							>
								LLM release dates, answered
							</h2>
						</div>
						<dl className="divide-y divide-border/60">
							{faqs.map((faq) => (
								<div key={faq.question} className="py-5">
									<dt className="font-display text-base font-semibold md:text-lg">
										{faq.question}
									</dt>
									<dd className="mt-2 text-sm leading-relaxed text-muted-foreground">
										{faq.answer}
									</dd>
								</div>
							))}
						</dl>
					</div>
				</section>

				{/* CTA */}
				<section className="border-t border-border/60">
					<div className="container mx-auto px-4 py-14 md:py-20">
						<div className="mx-auto flex max-w-3xl flex-col items-center gap-5 rounded-2xl border border-border/70 bg-card/50 px-6 py-10 text-center backdrop-blur md:py-12">
							<h2 className="font-display text-2xl font-bold tracking-tight text-balance md:text-3xl">
								Route to any of these models with one API
							</h2>
							<p className="max-w-xl text-balance text-sm text-muted-foreground md:text-base">
								Switch to the newest model the day it ships — no new SDK, no
								vendor lock-in. One key for every provider on this timeline.
							</p>
							<div className="flex flex-wrap items-center justify-center gap-3">
								<Button asChild size="lg" className="rounded-full">
									<Link href="/signup">
										Get your API key
										<ArrowRight className="ml-1 h-4 w-4" />
									</Link>
								</Button>
								<Button
									asChild
									size="lg"
									variant="outline"
									className="rounded-full"
								>
									<Link href="/models">Browse all models</Link>
								</Button>
							</div>
						</div>
					</div>
				</section>
			</main>

			<Footer />
		</>
	);
}
