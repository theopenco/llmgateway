import { ActivityClient } from "@/components/activity/activity-client";
import { fetchServerData } from "@/lib/server-api";

import type { ActivitT, LogsData } from "@/types/activity";

// Force dynamic rendering since this page uses server-side data fetching with cookies
export const dynamic = "force-dynamic";

export default async function ActivityPage({
	params,
	searchParams,
}: {
	params: Promise<{ orgId: string; projectId: string }>;
	searchParams?: Promise<{
		days?: string;
		startDate?: string;
		endDate?: string;
		finishReason?: string;
		unifiedFinishReason?: string;
		provider?: string;
		model?: string;
		limit?: string;
	}>;
}) {
	const { projectId } = await params;
	const searchParamsData = await searchParams;
	const days = searchParamsData?.days;

	// Default to "7" days, only use "30" if explicitly specified
	const daysParam = days === "30" ? "30" : "7";

	// Build query parameters for logs - same as client-side
	const logsQueryParams: Record<string, string> = {
		orderBy: "createdAt_desc",
		projectId,
		limit: "10",
	};

	// Add optional filter parameters if they exist
	if (searchParamsData?.startDate) {
		logsQueryParams.startDate = searchParamsData.startDate;
	}
	if (searchParamsData?.endDate) {
		logsQueryParams.endDate = searchParamsData.endDate;
	}
	if (
		searchParamsData?.finishReason &&
		searchParamsData.finishReason !== "all"
	) {
		logsQueryParams.finishReason = searchParamsData.finishReason;
	}
	if (
		searchParamsData?.unifiedFinishReason &&
		searchParamsData.unifiedFinishReason !== "all"
	) {
		logsQueryParams.unifiedFinishReason = searchParamsData.unifiedFinishReason;
	}
	if (searchParamsData?.provider && searchParamsData.provider !== "all") {
		logsQueryParams.provider = searchParamsData.provider;
	}
	if (searchParamsData?.model && searchParamsData.model !== "all") {
		logsQueryParams.model = searchParamsData.model;
	}

	if (searchParamsData?.limit) {
		logsQueryParams.limit = searchParamsData.limit;
	}

	// Server-side data fetching for logs with all query parameters
	const initialLogsData = await fetchServerData<LogsData>("GET", "/logs", {
		params: {
			query: logsQueryParams,
		},
	});

	// Server-side data fetching for activity data
	const initialActivityData = await fetchServerData<ActivitT>(
		"GET",
		"/activity",
		{
			params: {
				query: {
					days: daysParam,
					projectId,
				},
			},
		},
	);

	return (
		<ActivityClient
			initialLogsData={initialLogsData || undefined}
			initialActivityData={initialActivityData || undefined}
		/>
	);
}
