"use client";

import { useEffect, useState } from "react";

import { formatDateTime } from "@/lib/format-date.js";
import { UTC_TIME_ZONE } from "@/lib/timezone.js";
import { cn } from "@/lib/utils";

import { useDisplayTimeZone } from "./time-zone-provider";
import { Button } from "./ui/button";

/**
 * Local/UTC picker for how datetimes are displayed. Each option previews the
 * current time in that zone so the choice is concrete rather than abstract.
 * Persists to a cookie via the provider — nothing is stored server-side, and
 * stored data stays UTC either way.
 */
export function TimeZoneSetting({ className }: { className?: string }) {
	const { mode, browserTimeZone, setMode } = useDisplayTimeZone();
	// new Date() differs between server and client, so the previews only render
	// once mounted. They're illustrative, not data.
	const [now, setNow] = useState<Date | null>(null);

	useEffect(() => {
		setNow(new Date());
		const id = setInterval(() => setNow(new Date()), 30_000);
		return () => clearInterval(id);
	}, []);

	const options = [
		{
			key: "local" as const,
			label: "Local time",
			zone: browserTimeZone,
		},
		{
			key: "utc" as const,
			label: "UTC",
			zone: UTC_TIME_ZONE,
		},
	];

	return (
		<div className={cn("space-y-3", className)}>
			<div className="grid gap-2 sm:grid-cols-2">
				{options.map((option) => {
					const selected = mode === option.key;
					return (
						<Button
							key={option.key}
							type="button"
							variant="outline"
							onClick={() => setMode(option.key)}
							aria-pressed={selected}
							className={cn(
								"h-auto flex-col items-start gap-1 px-4 py-3 text-left whitespace-normal",
								selected && "border-primary ring-1 ring-primary",
							)}
						>
							<span className="text-sm font-medium">{option.label}</span>
							<span className="text-xs font-normal text-muted-foreground tabular-nums">
								{now
									? `${formatDateTime(now, option.zone, "monthDayYearHourMinute")} · ${option.zone}`
									: " "}
							</span>
						</Button>
					);
				})}
			</div>
			<p className="text-sm text-muted-foreground">
				Applies to every date, chart axis and tooltip across the dashboard,
				including how analytics are bucketed into days. Data is always stored in
				UTC.
			</p>
		</div>
	);
}
