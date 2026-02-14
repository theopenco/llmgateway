import { subDays, format } from "date-fns";

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
		from?: string;
		to?: string;
		apiKeyId?: string;
	}>;
}) {
	const { projectId } = await params;
	const searchParamsData = await searchParams;
	const apiKeyId = searchParamsData?.apiKeyId;

	const today = new Date();
	const fromParam =
		searchParamsData?.from || format(subDays(today, 6), "yyyy-MM-dd");
	const toParam = searchParamsData?.to || format(today, "yyyy-MM-dd");

	const initialActivityData = apiKeyId
		? null
		: await fetchServerData<ActivitT>("GET", "/activity", {
				params: {
					query: {
						from: fromParam,
						to: toParam,
						projectId,
					},
				},
			});

	return (
		<ModelUsageClient
			initialActivityData={initialActivityData || undefined}
			projectId={projectId}
		/>
	);
}
