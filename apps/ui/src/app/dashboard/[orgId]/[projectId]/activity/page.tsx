import { RecentLogs } from "@/components/activity/recent-logs";
import { Card, CardContent } from "@/lib/components/card";
import { fetchServerData } from "@/lib/server-api";

import type { LogsData } from "@/types/activity";

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
	const { orgId, projectId } = await params;
	const searchParamsData = await searchParams;

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

	return (
		<div className="flex flex-col">
			<div className="flex-1 space-y-4 p-4 pt-6 md:p-8">
				<h2 className="text-3xl font-bold tracking-tight">Activity Logs</h2>
				<p>Your recent API requests and system events</p>
				<div className="space-y-4">
					<Card>
						<CardContent>
							<RecentLogs
								initialData={initialLogsData ?? undefined}
								projectId={projectId}
								orgId={orgId}
							/>
						</CardContent>
					</Card>
				</div>
			</div>
		</div>
	);
}
