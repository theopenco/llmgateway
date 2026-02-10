import { UsageClient } from "@/components/usage/usage-client";
import { fetchServerData } from "@/lib/server-api";

import type { ActivitT } from "@/types/activity";

export default async function UsagePage({
	params,
}: {
	params?: Promise<{
		projectId?: string;
		days?: string;
	}>;
}) {
	const paramsData = await params;
	const projectId = paramsData?.projectId;
	const days = paramsData?.days;

	// Default to "7" days, only use "30" if explicitly specified
	const daysParam = days === "30" ? "30" : "7";

	// Only fetch if we have a projectId, otherwise let client-side handle it
	const initialActivityData = projectId
		? await fetchServerData<ActivitT>("GET", "/activity", {
				params: {
					query: {
						days: String(daysParam),
						projectId,
					},
				},
			})
		: null;

	return (
		<UsageClient
			initialActivityData={initialActivityData || undefined}
			projectId={projectId}
		/>
	);
}
