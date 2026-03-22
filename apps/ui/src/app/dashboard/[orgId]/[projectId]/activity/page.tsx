import { RecentLogs } from "@/components/activity/recent-logs";
import { Card, CardContent } from "@/lib/components/card";
import { fetchServerData } from "@/lib/server-api";

import type { LogsData } from "@/types/activity";

function extractUniqueModelsFromLogs(logs: LogsData["logs"] | undefined) {
	if (!logs?.length) {
		return { models: [] as string[], providers: [] as string[] };
	}

	const providerSet = new Set<string>();
	const modelSet = new Set<string>();

	for (const log of logs) {
		if (log.usedProvider) {
			providerSet.add(log.usedProvider);
		}
		if (log.usedModel) {
			const slashIndex = log.usedModel.indexOf("/");
			modelSet.add(
				slashIndex !== -1
					? log.usedModel.substring(slashIndex + 1)
					: log.usedModel,
			);
		}
	}

	return {
		models: Array.from(modelSet).sort(),
		providers: Array.from(providerSet).sort(),
	};
}

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

	// Fetch a larger batch for extracting unique models/providers, and the filtered page
	const [initialLogsData, allRecentLogs] = await Promise.all([
		fetchServerData<LogsData>("GET", "/logs", {
			params: {
				query: logsQueryParams,
			},
		}),
		// Fetch unfiltered logs to populate model/provider dropdowns
		fetchServerData<LogsData>("GET", "/logs", {
			params: {
				query: {
					orderBy: "createdAt_desc",
					projectId,
					limit: "100",
				},
			},
		}),
	]);

	const initialUniqueModels = extractUniqueModelsFromLogs(allRecentLogs?.logs);

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
								initialUniqueModels={initialUniqueModels}
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
