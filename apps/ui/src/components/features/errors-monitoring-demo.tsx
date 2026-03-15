"use client";

import { AlertCircle, CheckCircle2, Zap } from "lucide-react";

import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";
import { mockMetrics, generateMockActivityData } from "@/lib/mock-feature-data";

export function ErrorsMonitoringDemo() {
	const data = generateMockActivityData();

	const totalRequests = data.activity.reduce(
		(sum, day) => sum + day.requestCount,
		0,
	);
	const totalErrors = data.activity.reduce(
		(sum, day) => sum + day.errorCount,
		0,
	);
	const totalCached = data.activity.reduce(
		(sum, day) => sum + day.cacheCount,
		0,
	);

	const errorRate =
		totalRequests > 0 ? ((totalErrors / totalRequests) * 100).toFixed(2) : "0";
	const cacheRate =
		totalRequests > 0 ? ((totalCached / totalRequests) * 100).toFixed(2) : "0";

	return (
		<div className="grid gap-6 md:grid-cols-2">
			<Card>
				<CardHeader>
					<CardTitle>Error Rate</CardTitle>
					<CardDescription>
						Track reliability and identify issues early
					</CardDescription>
				</CardHeader>
				<CardContent>
					<div className="space-y-4">
						<div className="flex items-center justify-between p-4 rounded-lg border bg-red-50 dark:bg-red-950/20">
							<div className="flex items-center gap-3">
								<AlertCircle className="h-10 w-10 text-red-500" />
								<div>
									<p className="text-3xl font-bold text-red-600 dark:text-red-400">
										{errorRate}%
									</p>
									<p className="text-sm text-muted-foreground">Error Rate</p>
								</div>
							</div>
						</div>

						<div className="space-y-2">
							<div className="flex items-center justify-between text-sm">
								<span className="text-muted-foreground">Failed Requests</span>
								<span className="font-medium">
									{totalErrors.toLocaleString()}
								</span>
							</div>
							<div className="flex items-center justify-between text-sm">
								<span className="text-muted-foreground">
									Successful Requests
								</span>
								<span className="font-medium">
									{(totalRequests - totalErrors).toLocaleString()}
								</span>
							</div>
							<div className="flex items-center justify-between text-sm border-t pt-2">
								<span className="text-muted-foreground">Total Requests</span>
								<span className="font-semibold">
									{totalRequests.toLocaleString()}
								</span>
							</div>
						</div>
					</div>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Cache Performance</CardTitle>
					<CardDescription>
						Monitor cache efficiency and cost savings
					</CardDescription>
				</CardHeader>
				<CardContent>
					<div className="space-y-4">
						<div className="flex items-center justify-between p-4 rounded-lg border bg-green-50 dark:bg-green-950/20">
							<div className="flex items-center gap-3">
								<Zap className="h-10 w-10 text-green-500" />
								<div>
									<p className="text-3xl font-bold text-green-600 dark:text-green-400">
										{cacheRate}%
									</p>
									<p className="text-sm text-muted-foreground">
										Cache Hit Rate
									</p>
								</div>
							</div>
						</div>

						<div className="space-y-2">
							<div className="flex items-center justify-between text-sm">
								<span className="text-muted-foreground">Cached Responses</span>
								<span className="font-medium">
									{totalCached.toLocaleString()}
								</span>
							</div>
							<div className="flex items-center justify-between text-sm">
								<span className="text-muted-foreground">Estimated Savings</span>
								<span className="font-medium text-green-600">
									${((totalCached * 0.005) as number).toFixed(2)}
								</span>
							</div>
							<div className="flex items-center justify-between text-sm border-t pt-2">
								<span className="text-muted-foreground">Cache Efficiency</span>
								<span className="font-semibold">Excellent</span>
							</div>
						</div>
					</div>
				</CardContent>
			</Card>

			<Card className="md:col-span-2">
				<CardHeader>
					<CardTitle>Reliability Summary</CardTitle>
					<CardDescription>Overall system health metrics</CardDescription>
				</CardHeader>
				<CardContent>
					<div className="grid gap-4 md:grid-cols-4">
						<div className="flex flex-col items-center justify-center p-4 rounded-lg border">
							<CheckCircle2 className="h-8 w-8 text-green-500 mb-2" />
							<p className="text-2xl font-bold">
								{/* eslint-disable-next-line no-mixed-operators */}
								{((1 - totalErrors / totalRequests) * 100).toFixed(2)}%
							</p>
							<p className="text-sm text-muted-foreground text-center">
								Success Rate
							</p>
						</div>
						<div className="flex flex-col items-center justify-center p-4 rounded-lg border">
							<Zap className="h-8 w-8 text-blue-500 mb-2" />
							<p className="text-2xl font-bold">{mockMetrics.avgLatency}</p>
							<p className="text-sm text-muted-foreground text-center">
								Avg Latency
							</p>
						</div>
						<div className="flex flex-col items-center justify-center p-4 rounded-lg border">
							<AlertCircle className="h-8 w-8 text-orange-500 mb-2" />
							<p className="text-2xl font-bold">0</p>
							<p className="text-sm text-muted-foreground text-center">
								Critical Errors
							</p>
						</div>
						<div className="flex flex-col items-center justify-center p-4 rounded-lg border">
							<CheckCircle2 className="h-8 w-8 text-purple-500 mb-2" />
							<p className="text-2xl font-bold">99.2%</p>
							<p className="text-sm text-muted-foreground text-center">
								Uptime
							</p>
						</div>
					</div>
				</CardContent>
			</Card>
		</div>
	);
}
