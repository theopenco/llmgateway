import { useCallback, useMemo, useState } from "react";

interface ProfileHeatmapProps {
	activity: { date: string; requestCount: number }[];
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
	if (count === 0 || max === 0) {
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

export function ProfileHeatmap({ activity }: ProfileHeatmapProps) {
	const { weeks, max, monthMarks } = useMemo(() => {
		const today = new Date();
		today.setUTCHours(0, 0, 0, 0);

		const start = new Date(today);
		start.setUTCDate(start.getUTCDate() - 364);

		const gridStart = new Date(start);
		gridStart.setUTCDate(gridStart.getUTCDate() - start.getUTCDay());

		const totalDaysInGrid =
			Math.floor(
				(today.getTime() - gridStart.getTime()) / (1000 * 60 * 60 * 24),
			) + 1;
		const totalWeeks = Math.ceil(totalDaysInGrid / 7);

		const counts = new Map<string, number>();
		for (const row of activity) {
			const key = row.date.slice(0, 10);
			counts.set(key, (counts.get(key) ?? 0) + (row.requestCount ?? 0));
		}

		const weeksArr: Array<Array<DayCell | null>> = [];
		let maxCount = 0;

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
				week.push({ date: key, count: c });
			}
			weeksArr.push(week);
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
			if (d.getUTCDate() <= 7 && !seenMonths.has(month)) {
				seenMonths.add(month);
				marks.push({ weekIndex: w, label: MONTH_LABELS[month] });
			}
		}

		return { weeks: weeksArr, max: maxCount, monthMarks: marks };
	}, [activity]);

	const [hover, setHover] = useState<{
		count: number;
		date: string;
		x: number;
		y: number;
	} | null>(null);

	const scrollToEnd = useCallback((node: HTMLDivElement | null) => {
		if (node) {
			node.scrollLeft = node.scrollWidth;
		}
	}, []);

	return (
		<div ref={scrollToEnd} className="overflow-x-auto">
			<div className="flex w-fit flex-col gap-1.5">
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
										onMouseEnter={(e) => {
											const r = e.currentTarget.getBoundingClientRect();
											const halfWidth = r.width / 2;
											const centerX = r.left + halfWidth;
											setHover({
												count: cell.count,
												date: cell.date,
												x: centerX,
												y: r.top,
											});
										}}
										onMouseLeave={() => setHover(null)}
										className={`h-3 w-3 rounded-[3px] ring-1 ring-inset ring-foreground/5 transition-[box-shadow,ring] hover:ring-2 hover:ring-foreground/40 ${intensityClass(cell.count, max)}`}
									/>
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
			</div>

			{hover && (
				<div
					className="pointer-events-none fixed z-[100] -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md bg-foreground px-2.5 py-1.5 text-[11px] font-medium text-background shadow-[0_8px_24px_-4px_rgba(0,0,0,0.5)] ring-1 ring-foreground/10"
					style={{ left: hover.x, top: hover.y - 6 }}
				>
					<span className="font-mono tabular-nums">{hover.count}</span>{" "}
					<span className="text-background/70">
						{hover.count === 1 ? "request" : "requests"} ·{" "}
						{formatDateLong(hover.date)}
					</span>
					<span className="absolute left-1/2 top-full -ml-1 h-2 w-2 -translate-y-1 rotate-45 bg-foreground" />
				</div>
			)}
		</div>
	);
}
