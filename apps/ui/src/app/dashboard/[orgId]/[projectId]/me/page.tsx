import { DeveloperDashboardClient } from "@/components/dashboard/developer-dashboard-client";
import { fetchServerData } from "@/lib/server-api";

import type { MyMemberBudgetData } from "@/hooks/useTeam";

export default async function DeveloperDashboardPage({
	params,
}: {
	params: Promise<{ orgId: string; projectId: string }>;
}) {
	const { orgId } = await params;

	// Server-side fetch so the limits card renders filled in on first paint.
	const initialMemberBudget = await fetchServerData<MyMemberBudgetData>(
		"GET",
		"/team/{organizationId}/members/me",
		{
			params: {
				path: {
					organizationId: orgId,
				},
			},
		},
	);

	return (
		<DeveloperDashboardClient
			initialMemberBudget={initialMemberBudget ?? undefined}
		/>
	);
}
