"use client";

import { ArrowUpDown, ArrowUpRight, Search, Star } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import Footer from "@/components/landing/footer";
import { Navbar } from "@/components/landing/navbar";
import { Badge } from "@/lib/components/badge";
import { Button } from "@/lib/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";
import { cn } from "@/lib/utils";

import { models } from "@llmgateway/models";

const GATEWAY_LAUNCH = new Date("2025-05-01T00:00:00Z");

interface TimelineItem {
	id: string;
	name: string;
	family: string;
	releasedAt?: Date;
	publishedAt?: Date;
}

function formatDate(date: Date | null | undefined) {
	if (!date) {
		return "Unknown";
	}
	return date.toLocaleDateString(undefined, {
		year: "numeric",
		month: "short",
		day: "numeric",
	});
}

function isSignificant(item: TimelineItem) {
	const id = item.id.toLowerCase();
	const name = item.name.toLowerCase();

	// Rough heuristic: highlight major / flagship models
	const keywords = [
		"gpt-4",
		"gpt-4o",
		"gpt-5",
		"gpt-3.5",
		"claude-3",
		"claude 3",
		"claude 4",
		"sonnet",
		"opus",
		"gemini",
		"llama 3",
		"mixtral",
		"deepseek",
		"qwen",
	];

	return keywords.some((k) => id.includes(k) || name.includes(k));
}

export default function TimelinePage() {
	const [query, setQuery] = useState("");
	const [showSignificantOnly, setShowSignificantOnly] = useState(false);
	const [sortOrder, setSortOrder] = useState<"newest" | "oldest">("newest");

	const baseItems = useMemo<TimelineItem[]>(() => {
		const list = (models as any[]).map((model) => {
			const releasedAt =
				model.releasedAt instanceof Date
					? (model.releasedAt as Date)
					: undefined;

			let publishedAt =
				model.publishedAt instanceof Date
					? (model.publishedAt as Date)
					: undefined;

			// Clamp publishedAt to gateway launch date so we never show support
			// before LLM Gateway existed.
			if (publishedAt && publishedAt.getTime() < GATEWAY_LAUNCH.getTime()) {
				publishedAt = GATEWAY_LAUNCH;
			}

			return {
				id: String(model.id),
				name: (model.name as string | undefined) ?? String(model.id),
				family: String(model.family),
				releasedAt,
				publishedAt,
			};
		});

		return list;
	}, []);

	const timelineItems = useMemo(() => {
		const items = [...baseItems];
		items.sort((a, b) => {
			const aTime = a.releasedAt?.getTime() ?? 0;
			const bTime = b.releasedAt?.getTime() ?? 0;
			return sortOrder === "newest" ? bTime - aTime : aTime - bTime;
		});
		return items;
	}, [baseItems, sortOrder]);

	// Group by year
	const groupedByYear: Record<string, TimelineItem[]> = {};
	for (const item of timelineItems) {
		const year = item.releasedAt?.getFullYear()?.toString() ?? "Unknown";
		if (!groupedByYear[year]) {
			groupedByYear[year] = [];
		}
		groupedByYear[year].push(item);
	}

	const years = Object.keys(groupedByYear)
		.filter((y) => y !== "Unknown")
		.sort((a, b) => Number(b) - Number(a));

	const [activeYear, setActiveYear] = useState<string>(years[0] ?? "");

	const normalizedQuery = query.trim().toLowerCase();

	return (
		<>
			<Navbar />
			<div className="min-h-screen bg-background pt-20 md:pt-24 pb-16">
				<section className="py-10 md:py-12">
					<div className="container mx-auto px-4">
						<div className="max-w-3xl mx-auto text-center mb-8 space-y-3">
							<Badge variant="outline" className="text-xs">
								Model timeline
							</Badge>
							<h1 className="text-3xl md:text-4xl font-bold tracking-tight">
								LLM Gateway model support timeline
							</h1>
							<p className="text-muted-foreground text-sm md:text-base">
								See when each model was released by its provider and when it was
								added to LLM Gateway.
							</p>
						</div>

						{/* Top controls */}
						<div className="mb-10 space-y-4">
							<div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
								<div className="relative flex-1">
									<Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
									<input
										type="text"
										placeholder="Search models, providers, IDs..."
										className="w-full rounded-full border bg-background py-2 pl-9 pr-3 text-sm shadow-sm outline-none ring-0 placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary"
										value={query}
										onChange={(e) => setQuery(e.target.value)}
									/>
								</div>
								<div className="flex items-center gap-2 self-end md:self-auto">
									<button
										type="button"
										onClick={() => setShowSignificantOnly((v) => !v)}
										className={cn(
											"inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
											showSignificantOnly
												? "bg-yellow-500/10 text-yellow-400 border-yellow-500/40"
												: "bg-background text-muted-foreground hover:bg-muted",
										)}
									>
										<Star
											className={cn(
												"h-3.5 w-3.5",
												showSignificantOnly ? "fill-yellow-400" : "",
											)}
										/>
										<span>Significant</span>
									</button>
									<button
										type="button"
										onClick={() =>
											setSortOrder((prev) =>
												prev === "newest" ? "oldest" : "newest",
											)
										}
										className="inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium text-muted-foreground hover:bg-muted"
									>
										<ArrowUpDown className="h-3.5 w-3.5" />
										<span>{sortOrder === "newest" ? "Newest" : "Oldest"}</span>
									</button>
								</div>
							</div>

							<div className="flex flex-wrap gap-2">
								{years.map((year) => (
									<button
										key={year}
										type="button"
										onClick={() => setActiveYear(year)}
										className={cn(
											"rounded-full px-4 py-1 text-sm font-medium border transition-colors",
											activeYear === year
												? "bg-primary text-primary-foreground border-transparent"
												: "bg-background text-muted-foreground hover:bg-muted",
										)}
									>
										{year}
									</button>
								))}
							</div>
						</div>

						<div className="max-w-5xl mx-auto">
							<div className="relative">
								<div className="absolute left-4 md:left-6 top-0 bottom-0 w-px bg-border" />
								<div className="space-y-10">
									{years
										.filter((year) => year === activeYear)
										.map((year) => {
											const itemsForYear =
												(groupedByYear[year] as TimelineItem[]) || [];

											const filtered = itemsForYear.filter((item) => {
												if (normalizedQuery) {
													const haystack =
														`${item.name} ${item.id} ${item.family}`.toLowerCase();
													if (!haystack.includes(normalizedQuery)) {
														return false;
													}
												}
												if (showSignificantOnly && !isSignificant(item)) {
													return false;
												}
												return true;
											});

											if (filtered.length === 0) {
												return null;
											}

											let lastMonthKey = "";

											return (
												<div key={year} className="relative pl-10 md:pl-14">
													<div className="absolute left-1 md:left-0 top-1 flex h-12 w-12 items-center justify-center rounded-full border border-border bg-background">
														<span className="text-xs font-semibold">
															{year}
														</span>
													</div>
													<div className="mt-6 space-y-4">
														{filtered.map((item) => {
															const monthKey = item.releasedAt
																? `${item.releasedAt.getFullYear()}-${
																		item.releasedAt.getMonth() + 1
																	}`
																: "Unknown";

															const showMonthHeader = monthKey !== lastMonthKey;
															lastMonthKey = monthKey;

															const monthLabel = item.releasedAt
																? item.releasedAt.toLocaleString(undefined, {
																		month: "long",
																	})
																: "Unknown";

															return (
																<div key={item.id} className="space-y-2">
																	{showMonthHeader && (
																		<p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-400">
																			{monthLabel}
																		</p>
																	)}
																	<Card className="border-border/70 bg-background/80">
																		<CardHeader className="pb-3">
																			<div className="flex items-center justify-between gap-2">
																				<div className="space-y-1">
																					<CardTitle className="text-base md:text-lg">
																						{item.name}
																					</CardTitle>
																					<CardDescription className="text-xs md:text-sm">
																						Model ID:{" "}
																						<span className="font-mono text-[11px] md:text-xs">
																							{item.id}
																						</span>
																					</CardDescription>
																				</div>
																				<Badge
																					variant="secondary"
																					className="text-[11px]"
																				>
																					{item.family}
																				</Badge>
																			</div>
																		</CardHeader>
																		<CardContent className="grid gap-3 text-xs md:text-sm md:grid-cols-2">
																			<div className="space-y-1">
																				<p className="text-muted-foreground text-[11px] uppercase tracking-wide">
																					Provider release
																				</p>
																				<p className="font-medium">
																					{formatDate(item.releasedAt)}
																				</p>
																			</div>
																			<div className="space-y-1">
																				<p className="text-muted-foreground text-[11px] uppercase tracking-wide">
																					Added to LLM Gateway
																				</p>
																				<p className="font-medium">
																					{formatDate(item.publishedAt)}
																				</p>
																			</div>
																			<div className="space-y-1 md:col-span-2">
																				<Button variant="ghost" size="sm">
																					<Link
																						href={`/models/${encodeURIComponent(
																							item.id,
																						)}`}
																						className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
																					>
																						<span>View model details</span>
																						<ArrowUpRight className="h-3 w-3" />
																					</Link>
																				</Button>
																			</div>
																		</CardContent>
																	</Card>
																</div>
															);
														})}
													</div>
												</div>
											);
										})}
								</div>
							</div>
						</div>
					</div>
				</section>
			</div>
			<Footer />
		</>
	);
}
