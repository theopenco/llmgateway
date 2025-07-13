"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

import { RecentLogs } from "@/components/activity/recent-logs";
import { ActivityChart } from "@/components/dashboard/activity-chart";
import { useDashboardNavigation } from "@/hooks/useDashboardNavigation";
import { Button } from "@/lib/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";

import type { ActivitT } from "@/types/activity";

interface LogsData {
	message?: string;
	logs: {
		id: string;
		requestId: string;
		createdAt: string;
		updatedAt: string;
		organizationId: string;
		projectId: string;
		apiKeyId: string;
		duration: number;
		requestedModel: string;
		requestedProvider: string | null;
		usedModel: string;
		usedProvider: string;
		responseSize: number;
		content: string | null;
		unifiedFinishReason: string | null;
		finishReason: string | null;
		promptTokens: string | null;
		completionTokens: string | null;
		totalTokens: string | null;
		reasoningTokens: string | null;
		messages?: unknown;
		temperature: number | null;
		maxTokens: number | null;
		topP: number | null;
		frequencyPenalty: number | null;
		presencePenalty: number | null;
		hasError: boolean | null;
		errorDetails: {
			statusCode: number;
			statusText: string;
			responseText: string;
		} | null;
		cost: number | null;
		inputCost: number | null;
		outputCost: number | null;
		requestCost: number | null;
		estimatedCost: boolean | null;
		canceled: boolean | null;
		streamed: boolean | null;
		cached: boolean | null;
		mode: "api-keys" | "credits" | "hybrid";
		usedMode: "api-keys" | "credits";
	}[];
	pagination: {
		nextCursor: string | null;
		hasMore: boolean;
		limit: number;
	};
}

interface ActivityClientProps {
	initialLogsData?: LogsData;
	initialActivityData?: ActivitT;
}

export function ActivityClient({
	initialLogsData,
	initialActivityData,
}: ActivityClientProps) {
	const router = useRouter();
	const searchParams = useSearchParams();
	const { buildUrl } = useDashboardNavigation();

	const daysParam = searchParams.get("days");
	const days = daysParam === "30" ? 30 : 7;

	useEffect(() => {
		if (!daysParam) {
			const params = new URLSearchParams(searchParams.toString());
			params.set("days", "7");
			router.replace(`${buildUrl("activity")}?${params.toString()}`);
		}
	}, [daysParam, searchParams, router, buildUrl]);

	// Function to update days in URL
	const updateDaysInUrl = (newDays: 7 | 30) => {
		const params = new URLSearchParams(searchParams);
		params.set("days", String(newDays));
		router.push(`${buildUrl("activity")}?${params.toString()}`);
	};

	return (
		<div className="flex flex-col">
			<div className="flex-1 space-y-4 p-4 pt-6 md:p-8">
				<div className="flex items-center justify-between space-y-2">
					<h2 className="text-3xl font-bold tracking-tight">Activity</h2>
					<div className="flex items-center space-x-2">
						<Button
							variant={days === 7 ? "default" : "outline"}
							size="sm"
							onClick={() => updateDaysInUrl(7)}
						>
							7 Days
						</Button>
						<Button
							variant={days === 30 ? "default" : "outline"}
							size="sm"
							onClick={() => updateDaysInUrl(30)}
						>
							30 Days
						</Button>
					</div>
				</div>
				<div className="space-y-4">
					<ActivityChart initialData={initialActivityData} />
					<Card>
						<CardHeader>
							<div>
								<CardTitle>Recent Activity</CardTitle>
								<CardDescription>
									Your recent API requests and system events
								</CardDescription>
							</div>
						</CardHeader>
						<CardContent>
							<RecentLogs
								initialData={initialLogsData as LogsData | undefined}
							/>
						</CardContent>
					</Card>
				</div>
			</div>
		</div>
	);
}
