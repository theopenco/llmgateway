import { subDays, format } from "date-fns";

import { UsageClient } from "@/components/usage/usage-client";
import { fetchServerData } from "@/lib/server-api";

import type { ActivitT } from "@/types/activity";

export default async function UsagePage({
	params,
}: {
	params?: Promise<{
		projectId?: string;
		days?: string;
		from?: string;
		to?: string;
	}>;
}) {
	const paramsData = await params;
	const projectId = paramsData?.projectId;

	const today = new Date();
	const fromParam = paramsData?.from ?? format(subDays(today, 6), "yyyy-MM-dd");
	const toParam = paramsData?.to ?? format(today, "yyyy-MM-dd");

	const initialActivityData = projectId
		? await fetchServerData<ActivitT>("GET", "/activity", {
				params: {
					query: {
						from: fromParam,
						to: toParam,
						projectId,
					},
				},
			})
		: null;

	return (
		<UsageClient
			initialActivityData={initialActivityData ?? undefined}
			projectId={projectId}
		/>
	);
}
