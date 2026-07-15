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

interface RecentActivityCardProps {
	activityData: DailyActivity[];
	isLoading: boolean;
}

export function RecentActivityCard({
	activityData,
	isLoading,
}: RecentActivityCardProps) {
	if (isLoading) {
		return (
			<Card>
				<CardHeader>
					<CardTitle>Recent Activity</CardTitle>
					<CardDescription>Latest usage for this project</CardDescription>
				</CardHeader>
				<CardContent>
					<div className="flex h-[260px] items-center justify-center">
						<p className="text-muted-foreground">Loading recent activity...</p>
					</div>
				</CardContent>
			</Card>
		);
	}

	if (!activityData.length) {
		return (
			<Card>
				<CardHeader>
					<CardTitle>Recent Activity</CardTitle>
					<CardDescription>Latest usage for this project</CardDescription>
				</CardHeader>
				<CardContent>
					<div className="flex h-[260px] items-center justify-center">
						<p className="text-muted-foreground">No activity data available</p>
					</div>
				</CardContent>
			</Card>
		);
	}

	const latestDays = [...activityData]
		.sort((a, b) => (a.date < b.date ? 1 : -1))
		.slice(0, 7);
	const maxCost = Math.max(...latestDays.map((day) => day.cost), 0);

	return (
		<Card>
			<CardHeader>
				<CardTitle>Recent Activity</CardTitle>
				<CardDescription>Daily usage overview (last few days)</CardDescription>
			</CardHeader>
			<CardContent>
				<div className="space-y-2">
					{latestDays.map((day) => (
						<div
							key={day.date}
							className="rounded-lg border border-border/60 px-3 py-2 text-sm"
						>
							<div className="flex items-center justify-between gap-3">
								<div className="min-w-0">
									<p className="font-medium">
										{format(parseISO(day.date), "MMM d, yyyy")}
									</p>
									<p className="truncate text-xs text-muted-foreground">
										{day.requestCount.toLocaleString()} requests •{" "}
										{day.totalTokens.toLocaleString()} tokens
									</p>
								</div>
								<div className="shrink-0 text-right">
									<p className="font-semibold tabular-nums">
										${day.cost.toFixed(4)}
									</p>
									{day.discountSavings > 0 && (
										<p className="text-xs text-emerald-600 dark:text-emerald-400">
											-${day.discountSavings.toFixed(4)} saved
										</p>
									)}
								</div>
							</div>
							<div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
								<div
									className="h-full rounded-full bg-sky-500/70"
									style={{
										width:
											maxCost > 0
												? `${Math.max((day.cost / maxCost) * 100, 2)}%`
												: "0%",
									}}
								/>
							</div>
						</div>
					))}
				</div>
			</CardContent>
		</Card>
	);
}
