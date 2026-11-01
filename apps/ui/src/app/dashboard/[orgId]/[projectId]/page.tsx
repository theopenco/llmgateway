import { HydrationBoundary, dehydrate } from "@tanstack/react-query";
import { redirect } from "next/navigation";

import { DashboardClient } from "@/components/dashboard/dashboard-client";
import { getOrganizations } from "@/lib/server-api";
import { createServerQuery } from "@/lib/server-query";
import { getTimeZonePreference } from "@/lib/timezone-server";

import { formatDayKey, shiftDayKey } from "@llmgateway/shared";

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

	// Bucket and default the range in the user's display zone, the same key the
	// client query builds, so it picks up this prefetch instead of refetching.
	const { timeZone } = await getTimeZonePreference();
	const todayKey = formatDayKey(new Date(), timeZone);
	const fromParam = searchParamsData?.from ?? shiftDayKey(todayKey, -6);
	const toParam = searchParamsData?.to ?? todayKey;

	const orgsDataPromise = getOrganizations();

	// Not awaited: the page renders its loading state immediately and the
	// activity data streams in, instead of holding back the first paint.
	const { queryClient, api } = await createServerQuery();
	void queryClient.prefetchQuery(
		api.queryOptions("get", "/activity", {
			params: {
				query: {
					from: fromParam,
					to: toParam,
					timezone: timeZone,
					projectId,
				},
			},
		}),
	);

	// Project-scoped "developer" members don't get the project-wide dashboard —
	// send them to their personal usage view.
	const orgsData = await orgsDataPromise;
	const role = orgsData?.organizations?.find((o) => o.id === orgId)?.role;
	if (role === "developer") {
		redirect(`/dashboard/${orgId}/${projectId}/me`);
	}

	// A failed server request reaches the browser as an error; retry once there
	// with the client's own fetch, as the old null fallback did.
	return (
		<HydrationBoundary
			state={dehydrate(queryClient)}
			options={{ defaultOptions: { queries: { retry: 1 } } }}
		>
			<DashboardClient />
		</HydrationBoundary>
	);
}
