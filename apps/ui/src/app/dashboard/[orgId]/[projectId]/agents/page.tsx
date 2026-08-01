import { cookies } from "next/headers";

import { AgentsView } from "@/components/activity/agents-view";
import { DevPassCard } from "@/components/dashboard/devpass-card";
import { parseAgentTimeRange } from "@/lib/agent-time-ranges";
import { DEVPASS_CARD_COLLAPSED_COOKIE } from "@/lib/cookies";
import { fetchServerData } from "@/lib/server-api";

import type { SourceActivityData } from "@/types/activity";

export default async function AgentsPage({
	params,
	searchParams,
}: {
	params: Promise<{ orgId: string; projectId: string }>;
	searchParams?: Promise<{ timeRange?: string }>;
}) {
	const { orgId, projectId } = await params;
	const searchParamsData = await searchParams;

	const timeRange = parseAgentTimeRange(searchParamsData?.timeRange);

	const initialData = await fetchServerData<SourceActivityData>(
		"GET",
		"/activity/sources",
		{
			params: {
				query: {
					projectId,
					timeRange,
				},
			},
		},
	);

	const cookieStore = await cookies();
	const devPassCollapsed =
		cookieStore.get(DEVPASS_CARD_COLLAPSED_COOKIE)?.value === "1";

	return (
		<div className="flex flex-col">
			<div className="flex-1 space-y-4 p-4 pt-6 md:p-8">
				<DevPassCard defaultCollapsed={devPassCollapsed} />
				<div>
					<h2 className="text-3xl font-bold tracking-tight">Agents</h2>
					<p className="text-muted-foreground">
						Monitor your AI coding agents and their activity
					</p>
				</div>
				<AgentsView
					projectId={projectId}
					orgId={orgId}
					initialData={initialData ?? undefined}
				/>
			</div>
		</div>
	);
}
