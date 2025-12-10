"use client";

import { format, parseISO } from "date-fns";

import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";

import type { DailyActivity } from "@/types/activity";

interface ErrorsReliabilityCardProps {
	activityData: DailyActivity[];
	isLoading: boolean;
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
				<div className="grid grid-cols-2 gap-4 text-sm">
					<div className="rounded-md border p-3">
						<p className="mb-1 text-xs text-muted-foreground">Error rate</p>
						<p className="text-2xl font-bold">
							{errorRate.toFixed(2)}
							<span className="text-sm font-normal text-muted-foreground">
								{" "}
								%
							</span>
						</p>
						<p className="mt-1 text-xs text-muted-foreground">
							{totalErrors.toLocaleString()} failed of{" "}
							{totalRequests.toLocaleString()} requests
						</p>
					</div>
					<div className="rounded-md border p-3">
						<p className="mb-1 text-xs text-muted-foreground">Cache hit rate</p>
						<p className="text-2xl font-bold">
							{cacheRate.toFixed(2)}
							<span className="text-sm font-normal text-muted-foreground">
								{" "}
								%
							</span>
						</p>
						<p className="mt-1 text-xs text-muted-foreground">
							{totalCached.toLocaleString()} cached responses
						</p>
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
									className="flex items-center justify-between rounded-md border px-2 py-1"
								>
									<span>{format(parseISO(day.date), "MMM d, yyyy")}</span>
									<span className="font-semibold">
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
