import { DashboardClient } from "@/components/dashboard/dashboard-client";
import { fetchServerData } from "@/lib/server-api";
import type { ActivitT } from "@/types/activity";

// Force dynamic rendering since this page uses server-side data fetching with cookies
export const dynamic = "force-dynamic";

export default async function Dashboard({
	params,
	searchParams,
}: {
	params: Promise<{ orgId: string; projectId: string }>;
	searchParams?: Promise<{
		days?: string;
	}>;
}) {
	const { projectId } = await params;
	const searchParamsData = searchParams ? await searchParams : {};
	const days = searchParamsData?.days;

	// Default to "7" days, only use "30" if explicitly specified
	const daysParam = days === "30" ? "30" : "7";

	// Fetch activity data for this specific project
	const initialActivityData = await fetchServerData<ActivitT>(
		"GET",
		"/activity",
		{
			params: {
				query: {
					days: daysParam,
					projectId,
				},
			},
		},
	);

	return (
		<DashboardClient initialActivityData={initialActivityData || undefined} />
	);
}
