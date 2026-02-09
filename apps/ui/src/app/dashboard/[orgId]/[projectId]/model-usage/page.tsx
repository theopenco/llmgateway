import { ModelUsageClient } from "@/components/usage/model-usage-client";
import { fetchServerData } from "@/lib/server-api";

import type { ActivitT } from "@/types/activity";

export default async function ModelUsagePage({
	params,
	searchParams,
}: {
	params: Promise<{ orgId: string; projectId: string }>;
	searchParams?: Promise<{
		days?: string;
		apiKeyId?: string;
	}>;
}) {
	const { projectId, orgId } = await params;
	const searchParamsData = await searchParams;
	const daysParam = searchParamsData?.days;
	const apiKeyId = searchParamsData?.apiKeyId;

	const days = daysParam === "30" ? 30 : 7;

	// Server-side data fetching for activity data (only if no apiKeyId filter)
	const initialActivityData = apiKeyId
		? null
		: await fetchServerData<ActivitT>("GET", "/activity", {
				params: {
					query: {
						days: String(days),
						projectId,
					},
				},
			});

	return (
		<ModelUsageClient
			initialActivityData={initialActivityData || undefined}
			orgId={orgId}
			projectId={projectId}
		/>
	);
}
