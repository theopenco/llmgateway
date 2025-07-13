import { UsageClient } from "@/components/usage/usage-client";
import { fetchServerData } from "@/lib/server-api";

import type { ActivitT } from "@/types/activity";

// Force dynamic rendering since this page uses server-side data fetching with cookies
export const dynamic = "force-dynamic";

export default async function UsagePage({
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

	return <UsageClient initialActivityData={initialActivityData || undefined} />;
}
