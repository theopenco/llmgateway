import { subDays, format } from "date-fns";
import { redirect } from "next/navigation";

import { DashboardClient } from "@/components/dashboard/dashboard-client";
import { fetchServerData, getOrganizations } from "@/lib/server-api";

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
	const { orgId, projectId } = await params;
	const searchParamsData = searchParams ? await searchParams : {};

	const today = new Date();
	const fromParam =
		searchParamsData?.from ?? format(subDays(today, 6), "yyyy-MM-dd");
	const toParam = searchParamsData?.to ?? format(today, "yyyy-MM-dd");

	const orgsDataPromise = getOrganizations();

	const initialActivityDataPromise = fetchServerData<ActivitT>(
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

	// Project-scoped "developer" members don't get the project-wide dashboard —
	// send them to their personal usage view.
	const orgsData = await orgsDataPromise;
	const role = orgsData?.organizations?.find((o) => o.id === orgId)?.role;
	if (role === "developer") {
		redirect(`/dashboard/${orgId}/${projectId}/me`);
	}

	const initialActivityData = await initialActivityDataPromise;

	return (
		<DashboardClient initialActivityData={initialActivityData ?? undefined} />
	);
}
