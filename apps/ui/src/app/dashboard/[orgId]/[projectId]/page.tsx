import { subDays, format } from "date-fns";

import { DashboardClient } from "@/components/dashboard/dashboard-client";
import { fetchServerData } from "@/lib/server-api";

import type { ActivitT } from "@/types/activity";

export default async function Dashboard({
	params,
	searchParams,
}: {
	params: Promise<{ orgId: string; projectId: string }>;
	searchParams?: Promise<{
		days?: string;
		from?: string;
		to?: string;
	}>;
}) {
	const { projectId } = await params;
	const searchParamsData = searchParams ? await searchParams : {};

	const today = new Date();
	const fromParam =
		searchParamsData?.from ?? format(subDays(today, 6), "yyyy-MM-dd");
	const toParam = searchParamsData?.to ?? format(today, "yyyy-MM-dd");

	const initialActivityData = await fetchServerData<ActivitT>(
		"GET",
		"/activity",
		{
			params: {
				query: {
					from: fromParam,
					to: toParam,
					projectId,
				},
			},
		},
	);

	return (
		<DashboardClient initialActivityData={initialActivityData ?? undefined} />
	);
}
