"use client";

import { format, parseISO } from "date-fns";

import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";
import { cn } from "@/lib/utils";

import type { DailyActivity } from "@/types/activity";

interface ErrorsReliabilityCardProps {
	activityData: DailyActivity[];
	isLoading: boolean;
}

function RateStat({
	label,
	rate,
	detail,
	tone,
}: {
	label: string;
	rate: number;
	detail: string;
	tone: "good" | "warn" | "bad" | "neutral";
}) {
	const toneColors = {
		good: "bg-emerald-500",
		warn: "bg-amber-500",
		bad: "bg-red-500",
		neutral: "bg-sky-500",
	} as const;

	return (
		<div className="rounded-lg border border-border/60 p-3">
			<div className="flex items-center gap-1.5">
				<span
					className={cn("h-1.5 w-1.5 rounded-full", toneColors[tone])}
					aria-hidden
				/>
				<p className="text-xs text-muted-foreground">{label}</p>
			</div>
			<p className="mt-1.5 text-2xl font-bold tabular-nums">
				{rate.toFixed(2)}
				<span className="text-sm font-normal text-muted-foreground"> %</span>
			</p>
			<div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
				<div
					className={cn("h-full rounded-full", toneColors[tone])}
					style={{
						width: `${Math.min(100, Math.max(rate, rate > 0 ? 2 : 0))}%`,
					}}
				/>
			</div>
			<p className="mt-2 text-xs text-muted-foreground">{detail}</p>
		</div>
	);
}

export function ErrorsReliabilityCard({
	activityData,
	isLoading,
}: ErrorsReliabilityCardProps) {
	if (isLoading) {
		return (
			<Card>
				<CardHeader>
					<CardTitle>Errors & Reliability</CardTitle>
					<CardDescription>Error rate and cache health</CardDescription>
				</CardHeader>
				<CardContent>
					<div className="flex h-[260px] items-center justify-center">
						<p className="text-muted-foreground">Loading reliability data...</p>
					</div>
				</CardContent>
			</Card>
		);
	}

	if (!activityData.length) {
		return (
			<Card>
				<CardHeader>
					<CardTitle>Errors & Reliability</CardTitle>
					<CardDescription>Error rate and cache health</CardDescription>
				</CardHeader>
				<CardContent>
					<div className="flex h-[260px] items-center justify-center">
						<p className="text-muted-foreground">No activity data available</p>
					</div>
				</CardContent>
			</Card>
		);
	}

	const totalRequests = activityData.reduce(
		(sum, day) => sum + day.requestCount,
		0,
	);
	const totalErrors = activityData.reduce(
		(sum, day) => sum + day.errorCount,
		0,
	);
	const totalCached = activityData.reduce(
		(sum, day) => sum + day.cacheCount,
		0,
	);

	const errorRate = totalRequests > 0 ? (totalErrors / totalRequests) * 100 : 0;
	const cacheRate = totalRequests > 0 ? (totalCached / totalRequests) * 100 : 0;
	const successRate = 100 - errorRate;

	const errorTone: "good" | "warn" | "bad" =
		errorRate < 1 ? "good" : errorRate < 5 ? "warn" : "bad";

	const worstErrorDays = [...activityData]
		.filter((d) => d.errorCount > 0)
		.sort((a, b) => b.errorRate - a.errorRate)
		.slice(0, 3);

	return (
		<Card>
			<CardHeader>
				<CardTitle>Errors & Reliability</CardTitle>
				<CardDescription>
					Overall error and cache rates for this period
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="grid grid-cols-2 gap-3 text-sm">
					<RateStat
						label="Error rate"
						rate={errorRate}
						detail={`${totalErrors.toLocaleString()} failed of ${totalRequests.toLocaleString()} requests`}
						tone={errorTone}
					/>
					<RateStat
						label="Cache hit rate"
						rate={cacheRate}
						detail={`${totalCached.toLocaleString()} cached responses`}
						tone="neutral"
					/>
				</div>

				<div className="rounded-lg border border-border/60 p-3">
					<div className="flex items-center justify-between">
						<p className="text-xs text-muted-foreground">Success rate</p>
						<p className="text-sm font-semibold tabular-nums">
							{successRate.toFixed(2)}%
						</p>
					</div>
					<div className="mt-2 flex h-1.5 gap-px overflow-hidden rounded-full bg-muted">
						<div
							className="h-full rounded-l-full bg-emerald-500"
							style={{ width: `${successRate}%` }}
						/>
						{errorRate > 0 && (
							<div
								className="h-full rounded-r-full bg-red-500"
								style={{ width: `${Math.max(errorRate, 1)}%` }}
							/>
						)}
					</div>
				</div>

				{worstErrorDays.length > 0 && (
					<div className="space-y-2">
						<p className="text-xs font-medium text-muted-foreground">
							Days with highest error rate
						</p>
						<div className="space-y-1 text-xs">
							{worstErrorDays.map((day) => (
								<div
									key={day.date}
									className="flex items-center justify-between rounded-md border border-border/60 px-2.5 py-1.5"
								>
									<span>{format(parseISO(day.date), "MMM d, yyyy")}</span>
									<span
										className={cn(
											"font-semibold tabular-nums",
											day.errorRate >= 5
												? "text-red-500"
												: day.errorRate >= 1
													? "text-amber-500"
													: "text-muted-foreground",
										)}
									>
										{day.errorRate.toFixed(2)}%
									</span>
								</div>
							))}
						</div>
					</div>
				)}
			</CardContent>
		</Card>
	);
}
