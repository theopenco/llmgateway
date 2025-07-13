import { ActivityClient } from "@/components/activity/activity-client";
import { fetchServerData } from "@/lib/server-api";

import type { ActivitT, LogsData } from "@/types/activity";

// Force dynamic rendering since this page uses server-side data fetching with cookies
export const dynamic = "force-dynamic";

export default async function ActivityPage({
	searchParams,
}: {
	searchParams?: Promise<{
		projectId?: string;
		days?: string;
	}>;
}) {
	const params = searchParams ? await searchParams : {};
	const projectId = params?.projectId;
	const days = params?.days;

	// Default to "7" days, only use "30" if explicitly specified
	const daysParam = days === "30" ? "30" : "7";

	// Server-side data fetching for logs
	const initialLogsData = await fetchServerData<LogsData>("GET", "/logs", {
		params: {
			query: {
				orderBy: "createdAt_desc",
				...(projectId ? { projectId } : {}),
			},
		},
	});

	// Server-side data fetching for activity data
	// Only fetch if we have a projectId, otherwise let client-side handle it
	const initialActivityData = projectId
		? await fetchServerData<ActivitT>("GET", "/activity", {
				params: {
					query: {
						days: daysParam,
						projectId,
					},
				},
			})
		: null;

	return (
		<ActivityClient
			initialLogsData={initialLogsData || undefined}
			initialActivityData={initialActivityData || undefined}
		/>
	);
}
