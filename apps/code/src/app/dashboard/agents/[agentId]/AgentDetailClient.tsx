"use client";

import {
	ArrowDown,
	ArrowLeft,
	ArrowUp,
	ArrowUpDown,
	Coins,
	Cpu,
	Loader2,
	Terminal,
	Zap,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { useMemo, useState } from "react";

import { AgentModelUsageChart } from "@/app/dashboard/components/AgentModelUsageChart";
import {
	AGENTS,
	type AgentStats,
	computeAgentStats,
	formatTokens,
	type ModelUsage,
} from "@/app/dashboard/components/coding-agents-shared";
import { useUser } from "@/hooks/useUser";
import { useApi } from "@/lib/fetch-client";

type ModelSortColumn =
	| "id"
	| "provider"
	| "requestCount"
	| "totalTokens"
	| "cost"
	| "cachedInputCost";
type SortDirection = "asc" | "desc";

function ModelUsageBreakdown({ models }: { models: ModelUsage[] }) {
	const [sortColumn, setSortColumn] = useState<ModelSortColumn>("cost");
	const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

	const handleSort = (column: ModelSortColumn) => {
		if (sortColumn === column) {
			setSortDirection(sortDirection === "asc" ? "desc" : "asc");
		} else {
			setSortColumn(column);
			setSortDirection(
				column === "id" || column === "provider" ? "asc" : "desc",
			);
		}
	};

	const sortIcon = (column: ModelSortColumn) => {
		if (sortColumn !== column) {
			return <ArrowUpDown className="ml-1 h-3 w-3 opacity-50" />;
		}
		return sortDirection === "asc" ? (
			<ArrowUp className="ml-1 h-3 w-3" />
		) : (
			<ArrowDown className="ml-1 h-3 w-3" />
		);
	};

	const sortedModels = useMemo(() => {
		const copy = [...models];
		copy.sort((a, b) => {
			const aValue = a[sortColumn];
			const bValue = b[sortColumn];
			if (typeof aValue === "string" && typeof bValue === "string") {
				return sortDirection === "asc"
					? aValue.localeCompare(bValue)
					: bValue.localeCompare(aValue);
			}
			return sortDirection === "asc"
				? (aValue as number) - (bValue as number)
				: (bValue as number) - (aValue as number);
		});
		return copy;
	}, [models, sortColumn, sortDirection]);

	const totalTokens = models.reduce((sum, m) => sum + m.totalTokens, 0);

	return (
		<div className="overflow-hidden rounded-xl border">
			<div className="border-b bg-muted/30 px-4 py-2.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
				Model usage
			</div>
			{models.length === 0 ? (
				<div className="px-4 py-6 text-center text-sm text-muted-foreground">
					No model usage data.
				</div>
			) : (
				<div className="overflow-x-auto">
					<table className="w-full text-sm">
						<thead>
							<tr className="border-b bg-muted/10 text-xs text-muted-foreground">
								<th className="px-4 py-2 text-left font-medium">
									<button
										type="button"
										onClick={() => handleSort("id")}
										className="inline-flex items-center hover:text-foreground"
									>
										Model
										{sortIcon("id")}
									</button>
								</th>
								<th className="px-4 py-2 text-left font-medium">
									<button
										type="button"
										onClick={() => handleSort("provider")}
										className="inline-flex items-center hover:text-foreground"
									>
										Provider
										{sortIcon("provider")}
									</button>
								</th>
								<th className="px-4 py-2 text-right font-medium">
									<button
										type="button"
										onClick={() => handleSort("requestCount")}
										className="inline-flex items-center hover:text-foreground"
									>
										Requests
										{sortIcon("requestCount")}
									</button>
								</th>
								<th className="px-4 py-2 text-right font-medium">
									<button
										type="button"
										onClick={() => handleSort("totalTokens")}
										className="inline-flex items-center hover:text-foreground"
									>
										Tokens
										{sortIcon("totalTokens")}
									</button>
								</th>
								<th className="px-4 py-2 text-right font-medium">
									<button
										type="button"
										onClick={() => handleSort("cost")}
										className="inline-flex items-center hover:text-foreground"
									>
										Cost
										{sortIcon("cost")}
									</button>
								</th>
								<th className="px-4 py-2 text-right font-medium">
									<button
										type="button"
										onClick={() => handleSort("cachedInputCost")}
										className="inline-flex items-center hover:text-foreground"
									>
										Cache cost
										{sortIcon("cachedInputCost")}
									</button>
								</th>
								<th className="hidden w-[180px] px-4 py-2 text-left font-medium sm:table-cell">
									Usage
								</th>
							</tr>
						</thead>
						<tbody className="divide-y">
							{sortedModels.map((model) => {
								const percentage =
									totalTokens === 0
										? 0
										: Math.round((model.totalTokens / totalTokens) * 100);
								return (
									<tr key={`${model.provider}-${model.id}`}>
										<td className="px-4 py-2.5 font-mono text-xs">
											{model.id}
										</td>
										<td className="px-4 py-2.5 text-xs text-muted-foreground">
											{model.provider}
										</td>
										<td className="px-4 py-2.5 text-right tabular-nums">
											{model.requestCount.toLocaleString()}
										</td>
										<td className="px-4 py-2.5 text-right tabular-nums">
											{formatTokens(model.totalTokens)}
										</td>
										<td className="px-4 py-2.5 text-right font-medium tabular-nums">
											${model.cost.toFixed(4)}
										</td>
										<td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
											{model.cachedInputCost > 0
												? `$${model.cachedInputCost.toFixed(4)}`
												: "—"}
										</td>
										<td className="hidden px-4 py-2.5 sm:table-cell">
											<div className="flex items-center gap-2">
												<div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
													<div
														className="h-full bg-foreground/60"
														style={{ width: `${percentage}%` }}
													/>
												</div>
												<span className="w-9 text-right text-xs text-muted-foreground tabular-nums">
													{percentage}%
												</span>
											</div>
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>
			)}
		</div>
	);
}

function AgentDetailBody({
	stats,
	projectId,
}: {
	stats: AgentStats;
	projectId: string;
}) {
	const Icon = stats.agent.icon;
	const recent = stats.logs
		.slice()
		.sort(
			(a, b) =>
				new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
		)
		.slice(0, 20);

	return (
		<div className="space-y-4">
			<div className="flex items-center gap-4 rounded-xl border bg-card p-5">
				<div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-muted">
					<Icon className="h-6 w-6" />
				</div>
				<div className="flex-1">
					<h3 className="text-lg font-semibold tracking-tight">
						{stats.agent.label}
					</h3>
					<div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
						<span>{stats.requestCount.toLocaleString()} requests</span>
						<span className="text-border">·</span>
						<span>${stats.totalCost.toFixed(2)} this period</span>
						<span className="text-border">·</span>
						<span>{formatTokens(stats.totalTokens)} tokens</span>
					</div>
				</div>
			</div>
			<AgentModelUsageChart projectId={projectId} />
			<ModelUsageBreakdown models={stats.modelBreakdown} />
			<div className="overflow-hidden rounded-xl border">
				<div className="border-b bg-muted/30 px-4 py-2.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
					Recent requests
				</div>
				<div className="divide-y">
					{recent.length === 0 ? (
						<div className="px-4 py-6 text-center text-sm text-muted-foreground">
							No requests yet.
						</div>
					) : (
						recent.map((log) => (
							<div
								key={log.id}
								className="flex items-center justify-between gap-4 px-4 py-3 text-sm"
							>
								<div className="min-w-0 flex-1">
									<p className="truncate font-mono text-xs text-muted-foreground">
										{log.usedModel ?? log.requestedModel ?? "—"}
									</p>
									<p className="text-xs text-muted-foreground/70">
										{new Date(log.createdAt).toLocaleString()}
									</p>
								</div>
								<div className="flex items-center gap-3 text-xs text-muted-foreground tabular-nums">
									<span
										title="Cache status"
										className={
											log.cached
												? "text-blue-500"
												: Number(log.cachedInputCost ?? 0) > 0
													? "text-blue-400"
													: "text-muted-foreground/50"
										}
									>
										<Zap className="mr-1 inline h-3 w-3" />
										{log.cached
											? "Cached"
											: Number(log.cachedInputCost ?? 0) > 0
												? "Partially cached"
												: "Not cached"}
									</span>
									<span title="Tokens">
										<Cpu className="mr-1 inline h-3 w-3" />
										{Number(log.totalTokens ?? 0).toLocaleString()}
									</span>
									<span title="Cost" className="font-medium text-foreground">
										<Coins className="mr-1 inline h-3 w-3" />$
										{(log.cost ?? 0).toFixed(4)}
									</span>
								</div>
							</div>
						))
					)}
				</div>
			</div>
		</div>
	);
}

export default function AgentDetailClient({ agentId }: { agentId: string }) {
	const api = useApi();
	const { user, isLoading: userLoading } = useUser({
		redirectTo: `/login?returnUrl=/dashboard/agents/${agentId}`,
		redirectWhen: "unauthenticated",
	});

	const agent = AGENTS.find((a) => a.id === agentId);
	if (!agent) {
		notFound();
	}

	const {
		data: devPlanStatus,
		isLoading: statusLoading,
		isError: statusError,
	} = api.useQuery(
		"get",
		"/dev-plans/status",
		{},
		{
			enabled: !!user,
		},
	);

	const orgId = devPlanStatus?.organizationId ?? null;
	const projectId = devPlanStatus?.projectId ?? null;

	const since = useMemo(() => {
		const d = new Date();
		d.setDate(d.getDate() - 30);
		return d.toISOString();
	}, []);
	const until = useMemo(() => new Date().toISOString(), []);

	const sourceParam = agent.sources.join(",");
	const {
		data,
		isLoading: logsLoading,
		isError: logsError,
	} = api.useQuery(
		"get",
		"/logs",
		{
			params: {
				query: {
					orgId: orgId ?? "",
					...(projectId ? { projectId } : {}),
					orderBy: "createdAt_desc",
					limit: "100",
					source: sourceParam,
					startDate: since,
					endDate: until,
				},
			},
		},
		{
			enabled: !!orgId && !!projectId,
			refetchOnWindowFocus: false,
			staleTime: 60_000,
		},
	);

	const allLogs = useMemo(() => data?.logs ?? [], [data]);
	const stats = useMemo(() => {
		const all = computeAgentStats(allLogs);
		return all.find((s) => s.agent.id === agent.id) ?? null;
	}, [allLogs, agent.id]);

	const isLoading = userLoading || statusLoading || logsLoading;

	return (
		<div className="space-y-4">
			<Link
				href="/dashboard"
				className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
			>
				<ArrowLeft className="h-4 w-4" />
				Back to dashboard
			</Link>
			{isLoading ? (
				<div className="flex h-[360px] items-center justify-center rounded-xl border bg-card/50">
					<Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
				</div>
			) : statusError || logsError ? (
				<div className="rounded-xl border border-destructive/30 bg-destructive/5 p-8 text-center">
					<h3 className="text-base font-semibold tracking-tight">
						Couldn&apos;t load usage
					</h3>
					<p className="mx-auto mt-1.5 max-w-md text-sm text-muted-foreground">
						Something went wrong fetching {agent.label} data. Refresh the page
						to try again.
					</p>
				</div>
			) : !projectId || !orgId ? (
				<div className="rounded-xl border bg-card/50 p-8 text-center">
					<div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
						<Terminal className="h-5 w-5 text-muted-foreground" />
					</div>
					<h3 className="text-base font-semibold tracking-tight">
						No active DevPass
					</h3>
					<p className="mx-auto mt-1.5 max-w-md text-sm text-muted-foreground">
						Subscribe to DevPass to see usage details for {agent.label}.
					</p>
				</div>
			) : !stats ? (
				<div className="rounded-xl border bg-card/50 p-8 text-center">
					<div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
						<agent.icon className="h-5 w-5 text-muted-foreground" />
					</div>
					<h3 className="text-base font-semibold tracking-tight">
						No activity for {agent.label}
					</h3>
					<p className="mx-auto mt-1.5 max-w-md text-sm text-muted-foreground">
						We haven&apos;t seen any requests from this agent in the last 30
						days. Run it with your DevPass key and it will show up here.
					</p>
				</div>
			) : (
				<AgentDetailBody stats={stats} projectId={projectId} />
			)}
		</div>
	);
}
