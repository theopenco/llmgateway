"use client";

import { ChevronRight, Terminal } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo } from "react";

import { useApi } from "@/lib/fetch-client";

import { formatNumber } from "@llmgateway/shared/number-format";

import {
	AGENTS,
	type AgentStats,
	formatLastActive,
	formatTokens,
} from "./coding-agents-shared";

function AgentCard({
	stats,
	onClick,
}: {
	stats: Pick<
		AgentStats,
		"agent" | "requestCount" | "totalCost" | "totalTokens" | "lastActive"
	>;
	onClick: () => void;
}) {
	const Icon = stats.agent.icon;
	return (
		<button
			type="button"
			onClick={onClick}
			className="group relative w-full overflow-hidden rounded-xl border border-border/60 bg-card p-5 text-left transition-all hover:border-foreground/15 hover:shadow-md"
		>
			<div className="flex items-start gap-4">
				<div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-muted">
					<Icon className="h-6 w-6" />
				</div>
				<div className="min-w-0 flex-1">
					<div className="flex items-center justify-between">
						<h3 className="text-sm font-semibold tracking-tight">
							{stats.agent.label}
						</h3>
						<ChevronRight className="h-4 w-4 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5 group-hover:text-muted-foreground" />
					</div>
					<p className="mt-1 text-2xl font-bold tracking-tight tabular-nums">
						${stats.totalCost.toFixed(2)}
					</p>
				</div>
			</div>
			<div className="mt-4 grid grid-cols-3 gap-3 border-t border-border/40 pt-3">
				<div>
					<p className="text-[11px] uppercase tracking-wider text-muted-foreground/60">
						Requests
					</p>
					<p className="text-sm font-medium tabular-nums">
						{formatNumber(stats.requestCount)}
					</p>
				</div>
				<div>
					<p className="text-[11px] uppercase tracking-wider text-muted-foreground/60">
						Tokens
					</p>
					<p className="text-sm font-medium tabular-nums">
						{formatTokens(stats.totalTokens)}
					</p>
				</div>
				<div>
					<p className="text-[11px] uppercase tracking-wider text-muted-foreground/60">
						Last active
					</p>
					<p className="text-sm font-medium">
						{formatLastActive(stats.lastActive)}
					</p>
				</div>
			</div>
		</button>
	);
}

function AgentsEmpty({ hadError = false }: { hadError?: boolean }) {
	return (
		<div className="rounded-xl border bg-card/50 p-8 text-center">
			<div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
				<Terminal className="h-5 w-5 text-muted-foreground" />
			</div>
			<h3 className="text-base font-semibold tracking-tight">
				No agent activity yet
			</h3>
			<p className="mx-auto mt-1.5 max-w-md text-sm text-muted-foreground">
				This view will fill in once you use your DevPass key with any of the
				supported coding agents. Set two env vars and run your tool.
			</p>
			<div className="mt-6 flex flex-wrap items-center justify-center gap-2">
				{AGENTS.map((agent) => (
					<span
						key={agent.id}
						className="inline-flex items-center gap-1.5 rounded-full border bg-background px-2.5 py-1 text-xs text-muted-foreground"
					>
						<agent.icon className="h-3.5 w-3.5" />
						{agent.label}
					</span>
				))}
			</div>
			{hadError && (
				<p className="mx-auto mt-5 max-w-sm text-xs text-muted-foreground/70">
					Couldn&apos;t reach the activity service just now — refresh in a
					moment if this looks wrong.
				</p>
			)}
		</div>
	);
}

export default function CodingAgents({
	orgId,
	projectId,
}: {
	orgId: string;
	projectId: string | null;
}) {
	const router = useRouter();
	const api = useApi();

	const { data, isLoading, error } = api.useQuery(
		"get",
		"/activity/sources",
		{ params: { query: { projectId: projectId ?? "", timeRange: "7d" } } },
		{
			enabled: !!orgId && !!projectId,
			refetchOnWindowFocus: false,
			staleTime: 60_000,
		},
	);
	const agentStats = useMemo(
		() =>
			AGENTS.flatMap((agent) => {
				const sources = agent.sources.map((source) => source.toLowerCase());
				const rows = (data?.sources ?? []).filter((row) =>
					sources.includes(row.source.toLowerCase()),
				);
				if (!rows.length) {
					return [];
				}
				return [
					{
						agent,
						requestCount: rows.reduce((sum, row) => sum + row.requestCount, 0),
						totalCost: rows.reduce((sum, row) => sum + row.cost, 0),
						totalTokens: rows.reduce((sum, row) => sum + row.totalTokens, 0),
						lastActive: new Date(
							Math.max(
								...rows.map((row) =>
									row.lastUsedAt ? Date.parse(row.lastUsedAt) : 0,
								),
							),
						),
					},
				];
			}).sort((a, b) => b.totalCost - a.totalCost),
		[data?.sources],
	);

	const totalCost = agentStats.reduce((sum, s) => sum + s.totalCost, 0);
	const totalRequests = agentStats.reduce((sum, s) => sum + s.requestCount, 0);

	return (
		<div>
			<div className="mb-4 flex items-end justify-between gap-4">
				<div>
					<h2 className="font-semibold">Coding Agents</h2>
					<p className="mt-0.5 text-sm text-muted-foreground">
						Per-tool usage, costs, and recent activity from the last 7 days.
						Open an agent to expand the time window.
					</p>
				</div>
				{agentStats.length > 0 && (
					<div className="hidden items-center gap-2 text-xs text-muted-foreground sm:flex">
						<span>{agentStats.length} active</span>
						<span className="text-border">·</span>
						<span>{formatNumber(totalRequests)} requests</span>
						<span className="text-border">·</span>
						<span className="font-medium text-foreground">
							${totalCost.toFixed(2)}
						</span>
					</div>
				)}
			</div>
			{isLoading ? (
				<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
					{[0, 1, 2].map((i) => (
						<div
							key={i}
							className="h-[136px] animate-pulse rounded-xl border bg-muted/30"
						/>
					))}
				</div>
			) : agentStats.length === 0 ? (
				<AgentsEmpty hadError={!!error} />
			) : (
				<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
					{agentStats.map((stats) => (
						<AgentCard
							key={stats.agent.id}
							stats={stats}
							onClick={() =>
								router.push(`/dashboard/agents/${stats.agent.id}` as never)
							}
						/>
					))}
				</div>
			)}
		</div>
	);
}
