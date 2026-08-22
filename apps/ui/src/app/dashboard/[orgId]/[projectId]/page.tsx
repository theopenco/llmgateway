import { redirect } from "next/navigation";

import { DashboardClient } from "@/components/dashboard/dashboard-client";
import { fetchServerData, getOrganizations } from "@/lib/server-api";
import { getTimeZonePreference } from "@/lib/timezone-server";

import { formatDayKey, shiftDayKey } from "@llmgateway/shared";

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

	// Bucket and default the range in the user's display zone, and hand the
	// same zone to the client query below. Seeding a local-zone query with a
	// UTC-bucketed response would show UTC buckets labelled as local until the
	// query's staleTime expires.
	const { timeZone } = await getTimeZonePreference();
	const todayKey = formatDayKey(new Date(), timeZone);
	const fromParam = searchParamsData?.from ?? shiftDayKey(todayKey, -6);
	const toParam = searchParamsData?.to ?? todayKey;

	const orgsDataPromise = getOrganizations();

	const initialActivityDataPromise = fetchServerData<ActivitT>(
		"GET",
		"/activity",
		{
			params: {
				query: {
					from: fromParam,
					to: toParam,
					timezone: timeZone,
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
		<DashboardClient
			initialActivityData={initialActivityData ?? undefined}
			initialActivityTimeZone={timeZone}
		/>
	);
}
