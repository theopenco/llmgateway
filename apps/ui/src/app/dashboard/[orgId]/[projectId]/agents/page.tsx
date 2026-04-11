import { subDays } from "date-fns";

import { AgentsView } from "@/components/activity/agents-view";
import { fetchServerData } from "@/lib/server-api";

import type { LogsData } from "@/types/activity";

const AGENT_SOURCES = [
	"claude.com/claude-code",
	"opencode",
	"open-code",
	"cursor",
	"autohand",
	"soulforge",
	"cline",
	"codex",
	"n8n",
	"openclaw",
];

export default async function AgentsPage({
	params,
	searchParams,
}: {
	params: Promise<{ orgId: string; projectId: string }>;
	searchParams?: Promise<{ from?: string; to?: string }>;
}) {
	const { orgId, projectId } = await params;
	const searchParamsData = await searchParams;

	const parsedFrom = searchParamsData?.from
		? new Date(searchParamsData.from + "T00:00:00")
		: null;
	const parsedTo = searchParamsData?.to
		? new Date(searchParamsData.to + "T23:59:59.999")
		: null;
	const from =
		parsedFrom && !isNaN(parsedFrom.getTime())
			? parsedFrom
			: subDays(new Date(), 6);
	const to = parsedTo && !isNaN(parsedTo.getTime()) ? parsedTo : new Date();

	const initialData = await fetchServerData<LogsData>("GET", "/logs", {
		params: {
			query: {
				orderBy: "createdAt_desc",
				projectId,
				limit: "100",
				source: AGENT_SOURCES.join(","),
				startDate: from.toISOString(),
				endDate: to.toISOString(),
			},
		},
	});

	return (
		<div className="flex flex-col">
			<div className="flex-1 space-y-4 p-4 pt-6 md:p-8">
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
