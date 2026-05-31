"use client";

import { Activity, Flame } from "lucide-react";
import { useMemo } from "react";

import { useApi } from "@/lib/fetch-client";

interface ActivityHeatmapProps {
	projectId: string | null;
}

interface DayCell {
	date: string;
	count: number;
}

const MONTH_LABELS = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
];

function intensityClass(count: number, max: number): string {
	if (count === 0) {
		return "bg-muted/40 dark:bg-muted/30";
	}
	if (max === 0) {
		return "bg-muted/40 dark:bg-muted/30";
	}
	const ratio = count / max;
	if (ratio < 0.15) {
		return "bg-emerald-500/25 dark:bg-emerald-500/30";
	}
	if (ratio < 0.4) {
		return "bg-emerald-500/45 dark:bg-emerald-500/50";
	}
	if (ratio < 0.7) {
		return "bg-emerald-500/70 dark:bg-emerald-500/75";
	}
	return "bg-emerald-500 dark:bg-emerald-400";
}

function dateKey(d: Date): string {
	const yyyy = d.getUTCFullYear();
	const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
	const dd = String(d.getUTCDate()).padStart(2, "0");
	return `${yyyy}-${mm}-${dd}`;
}

function formatDateLong(iso: string): string {
	const d = new Date(iso + "T00:00:00Z");
	return d.toLocaleDateString(undefined, {
		weekday: "short",
		month: "short",
		day: "numeric",
		year: "numeric",
		timeZone: "UTC",
	});
}

export default function ActivityHeatmap({ projectId }: ActivityHeatmapProps) {
	const api = useApi();

	const { data, isLoading } = api.useQuery(
		"get",
		"/activity",
		{
			params: {
				query: projectId
					? { projectId, timeRange: "365d" as const }
					: { timeRange: "365d" as const },
			},
		},
		{
			enabled: !!projectId,
			refetchOnWindowFocus: false,
			staleTime: 5 * 60_000,
		},
	);

	const { weeks, totalRequests, activeDays, currentStreak, max, monthMarks } =
		useMemo(() => {
			const today = new Date();
			today.setUTCHours(0, 0, 0, 0);

			const start = new Date(today);
			start.setUTCDate(start.getUTCDate() - 364);

			const dayOfWeekStart = start.getUTCDay();
			const gridStart = new Date(start);
			gridStart.setUTCDate(gridStart.getUTCDate() - dayOfWeekStart);

			const totalDaysInGrid =
				Math.floor(
					(today.getTime() - gridStart.getTime()) / (1000 * 60 * 60 * 24),
				) + 1;
			const totalWeeks = Math.ceil(totalDaysInGrid / 7);

			const counts = new Map<string, number>();
			if (data?.activity) {
				for (const row of data.activity) {
					const key = row.date.slice(0, 10);
					counts.set(key, (counts.get(key) ?? 0) + (row.requestCount ?? 0));
				}
			}

			const weeksArr: Array<Array<DayCell | null>> = [];
			let maxCount = 0;
			let totalReq = 0;
			let activeCount = 0;

			for (let w = 0; w < totalWeeks; w++) {
				const week: Array<DayCell | null> = [];
				for (let d = 0; d < 7; d++) {
					const cellDate = new Date(gridStart);
					const offset = w * 7;
					cellDate.setUTCDate(gridStart.getUTCDate() + offset + d);
					if (cellDate < start || cellDate > today) {
						week.push(null);
						continue;
					}
					const key = dateKey(cellDate);
					const c = counts.get(key) ?? 0;
					if (c > maxCount) {
						maxCount = c;
					}
					if (c > 0) {
						activeCount += 1;
					}
					totalReq += c;
					week.push({ date: key, count: c });
				}
				weeksArr.push(week);
			}

			let streak = 0;
			const cursor = new Date(today);
			while (cursor >= start) {
				const c = counts.get(dateKey(cursor)) ?? 0;
				if (c === 0) {
					break;
				}
				streak += 1;
				cursor.setUTCDate(cursor.getUTCDate() - 1);
			}

			const seenMonths = new Set<number>();
			const marks: Array<{ weekIndex: number; label: string }> = [];
			for (let w = 0; w < weeksArr.length; w++) {
				const firstReal = weeksArr[w]?.find((c): c is DayCell => c !== null);
				if (!firstReal) {
					continue;
				}
				const d = new Date(firstReal.date + "T00:00:00Z");
				const month = d.getUTCMonth();
				const day = d.getUTCDate();
				if (day <= 7 && !seenMonths.has(month)) {
					seenMonths.add(month);
					marks.push({ weekIndex: w, label: MONTH_LABELS[month] });
				}
			}

			return {
				weeks: weeksArr,
				totalRequests: totalReq,
				activeDays: activeCount,
				currentStreak: streak,
				max: maxCount,
				monthMarks: marks,
			};
		}, [data]);

	if (!projectId) {
		return null;
	}

	return (
		<section className="rounded-2xl border bg-card overflow-hidden">
			<div className="flex flex-col gap-1 border-b bg-gradient-to-br from-card to-card/40 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
				<div className="flex items-start gap-3">
					<div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/10 ring-1 ring-emerald-500/20">
						<Activity className="h-4 w-4 text-emerald-500" />
					</div>
					<div>
						<h2 className="text-base font-semibold tracking-tight">
							Coding activity
						</h2>
						<p className="text-xs text-muted-foreground">
							{totalRequests.toLocaleString()} requests across {activeDays}{" "}
							active days in the last year
						</p>
					</div>
				</div>
				{currentStreak > 0 && (
					<div className="flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-amber-600 dark:text-amber-400 self-start sm:self-center">
						<Flame className="h-3.5 w-3.5" />
						<span className="text-xs font-semibold tabular-nums">
							{currentStreak}-day streak
						</span>
					</div>
				)}
			</div>

			<div className="overflow-x-auto px-6 py-6">
				<div className="mx-auto flex w-fit flex-col gap-1.5">
					{isLoading ? (
						<div className="flex h-[126px] items-center text-xs text-muted-foreground">
							Loading your activity…
						</div>
					) : (
						<>
							<div className="flex h-3.5 gap-[3px] pl-7 text-[10px] text-muted-foreground">
								{weeks.map((_, w) => {
									const mark = monthMarks.find((m) => m.weekIndex === w);
									return (
										<div key={w} className="w-3 flex-shrink-0">
											{mark?.label ?? ""}
										</div>
									);
								})}
							</div>

							<div className="flex gap-[3px]">
								<div className="flex w-6 flex-shrink-0 flex-col gap-[3px] pr-1 text-[10px] text-muted-foreground">
									<div className="h-3" />
									<div className="h-3">Mon</div>
									<div className="h-3" />
									<div className="h-3">Wed</div>
									<div className="h-3" />
									<div className="h-3">Fri</div>
									<div className="h-3" />
								</div>
								{weeks.map((week, wi) => (
									<div key={wi} className="flex flex-col gap-[3px]">
										{week.map((cell, di) => {
											if (!cell) {
												return (
													<div
														key={di}
														className="h-3 w-3 rounded-[3px] bg-transparent"
													/>
												);
											}
											return (
												<div
													key={di}
													className={`group relative h-3 w-3 rounded-[3px] ring-1 ring-inset ring-foreground/5 transition-[box-shadow,ring] hover:z-50 hover:ring-2 hover:ring-foreground/40 ${intensityClass(cell.count, max)}`}
												>
													<div className="pointer-events-none absolute bottom-[calc(100%+6px)] left-1/2 z-[100] hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-foreground px-2.5 py-1.5 text-[11px] font-medium text-background shadow-[0_8px_24px_-4px_rgba(0,0,0,0.5)] ring-1 ring-foreground/10 group-hover:block">
														<span className="font-mono tabular-nums">
															{cell.count}
														</span>{" "}
														<span className="text-background/70">
															{cell.count === 1 ? "request" : "requests"} ·{" "}
															{formatDateLong(cell.date)}
														</span>
														<span className="absolute left-1/2 top-full -ml-1 h-2 w-2 -translate-y-1 rotate-45 bg-foreground" />
													</div>
												</div>
											);
										})}
									</div>
								))}
							</div>

							<div className="mt-2 flex items-center justify-end gap-2 text-[10px] text-muted-foreground">
								<span>Less</span>
								<div className="h-3 w-3 rounded-[3px] bg-muted/40 ring-1 ring-inset ring-foreground/5 dark:bg-muted/30" />
								<div className="h-3 w-3 rounded-[3px] bg-emerald-500/25 dark:bg-emerald-500/30" />
								<div className="h-3 w-3 rounded-[3px] bg-emerald-500/45 dark:bg-emerald-500/50" />
								<div className="h-3 w-3 rounded-[3px] bg-emerald-500/70 dark:bg-emerald-500/75" />
								<div className="h-3 w-3 rounded-[3px] bg-emerald-500 dark:bg-emerald-400" />
								<span>More</span>
							</div>
						</>
					)}
				</div>
			</div>
		</section>
	);
}
