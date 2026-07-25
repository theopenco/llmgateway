"use client";

import {
	ArrowDown,
	ArrowLeft,
	ArrowUp,
	ArrowUpDown,
	Coins,
	Cpu,
	Download,
	Loader2,
	Terminal,
	Zap,
} from "lucide-react";
import Link from "next/link";
import { notFound, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { AgentModelUsageChart } from "@/app/dashboard/components/AgentModelUsageChart";
import {
	type AgentDefinition,
	AGENTS,
	type ApiLog,
	computeModelBreakdown,
	formatTokens,
	type ModelUsage,
} from "@/app/dashboard/components/coding-agents-shared";
import { useUser } from "@/hooks/useUser";
import { useApi, useFetchClient } from "@/lib/fetch-client";

type ModelSortColumn =
	| "id"
	| "provider"
	| "requestCount"
	| "totalTokens"
	| "cost"
	| "cachedInputCost";
type SortDirection = "asc" | "desc";

const AGENT_TIME_RANGES = ["1h", "4h", "24h", "7d", "30d"] as const;

export type AgentTimeRange = (typeof AGENT_TIME_RANGES)[number];

const AGENT_TIME_RANGE_HOURS: Record<AgentTimeRange, number> = {
	"1h": 1,
	"4h": 4,
	"24h": 24,
	"7d": 7 * 24,
	"30d": 30 * 24,
};

function parseAgentTimeRange(value: string | null | undefined): AgentTimeRange {
	return (AGENT_TIME_RANGES as readonly string[]).includes(value ?? "")
		? (value as AgentTimeRange)
		: "30d";
}

const CSV_HEADERS = [
	"createdAt",
	"usedProvider",
	"usedModel",
	"finishReason",
	"promptTokens",
	"completionTokens",
	"totalTokens",
	"cachedTokens",
	"cost",
	"hasError",
	"streamed",
	"duration",
	"requestId",
	"id",
];

function escapeCsvValue(value: unknown): string {
	if (value === null || value === undefined) {
		return "";
	}
	let str = String(value);
	// Guard against spreadsheet formula injection for string values.
	if (typeof value === "string" && /^[=+\-@\t\r]/.test(str)) {
		str = `'${str}`;
	}
	if (/[",\n]/.test(str)) {
		return `"${str.replace(/"/g, '""')}"`;
	}
	return str;
}

// String(number) switches to exponent notation below 1e-6 (e.g. "3.5e-7"),
// which spreadsheets don't reliably parse as a float.
function formatCostForCsv(cost: number | null | undefined): string {
	if (cost === null || cost === undefined) {
		return "";
	}
	return cost.toFixed(15).replace(/\.?0+$/, "");
}

function buildLogsCsv(logs: ApiLog[]): string {
	const rows = logs.map((log) =>
		[
			log.createdAt,
			log.usedProvider,
			log.usedModel,
			log.unifiedFinishReason ?? log.finishReason ?? "",
			log.promptTokens,
			log.completionTokens,
			log.totalTokens,
			log.cachedTokens ?? "",
			formatCostForCsv(log.cost),
			log.hasError,
			log.streamed,
			log.duration,
			log.requestId,
			log.id,
		]
			.map(escapeCsvValue)
			.join(","),
	);
	return [CSV_HEADERS.join(","), ...rows].join("\n");
}

function TimeRangePicker({
	value,
	onChange,
}: {
	value: AgentTimeRange;
	onChange: (value: AgentTimeRange) => void;
}) {
	return (
		<div className="inline-flex items-center rounded-md border bg-muted p-0.5">
			{AGENT_TIME_RANGES.map((range) => (
				<button
					key={range}
					type="button"
					aria-pressed={value === range}
					onClick={() => onChange(range)}
					className={`rounded-sm px-2.5 py-1 text-xs font-medium transition-colors ${
						value === range
							? "bg-background text-foreground shadow-sm"
							: "text-muted-foreground hover:text-foreground"
					}`}
				>
					{range}
				</button>
			))}
		</div>
	);
}

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

function RequestRow({ log }: { log: ApiLog }) {
	return (
		<div className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
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
					<Coins className="mr-1 inline h-3 w-3" />${(log.cost ?? 0).toFixed(4)}
				</span>
			</div>
		</div>
	);
}

function AgentDetailBody({
	agent,
	orgId,
	projectId,
}: {
	agent: AgentDefinition;
	orgId: string;
	projectId: string;
}) {
	const Icon = agent.icon;
	const api = useApi();
	const router = useRouter();
	const searchParams = useSearchParams();

	const timeRange = parseAgentTimeRange(searchParams.get("timeRange"));

	const updateTimeRange = (newTimeRange: AgentTimeRange) => {
		const params = new URLSearchParams(searchParams);
		params.set("timeRange", newTimeRange);
		router.replace(`/dashboard/agents/${agent.id}?${params.toString()}`, {
			scroll: false,
		});
	};

	const range = useMemo(() => {
		const to = new Date();
		const windowMs = AGENT_TIME_RANGE_HOURS[timeRange] * 60 * 60 * 1000;
		const from = new Date(to.getTime() - windowMs);
		return { from: from.toISOString(), to: to.toISOString() };
	}, [timeRange]);

	// Aggregated totals for the whole window, independent of how many log
	// pages have been loaded so far.
	const { data: sourcesData } = api.useQuery(
		"get",
		"/activity/sources",
		{
			params: {
				query: {
					projectId,
					timeRange,
				},
			},
		},
		{
			refetchOnWindowFocus: false,
			staleTime: 5 * 60 * 1000,
		},
	);

	const totals = useMemo(() => {
		if (!sourcesData) {
			return null;
		}
		const sources = agent.sources.map((s) => s.toLowerCase());
		const rows = sourcesData.sources.filter((row) =>
			sources.includes(row.source.toLowerCase()),
		);
		return {
			requestCount: rows.reduce((sum, row) => sum + row.requestCount, 0),
			totalCost: rows.reduce((sum, row) => sum + row.cost, 0),
			totalTokens: rows.reduce((sum, row) => sum + row.totalTokens, 0),
		};
	}, [sourcesData, agent.sources]);

	const logsQuery = useMemo(
		() => ({
			orgId,
			projectId,
			orderBy: "createdAt_desc" as const,
			limit: "100",
			source: agent.sources.join(","),
			startDate: range.from,
			endDate: range.to,
		}),
		[orgId, projectId, agent.sources, range.from, range.to],
	);

	const {
		data,
		isLoading: logsLoading,
		isError: logsError,
		fetchNextPage,
		hasNextPage,
		isFetchingNextPage,
	} = api.useInfiniteQuery(
		"get",
		"/logs",
		{
			params: {
				query: logsQuery,
			},
		},
		{
			refetchOnWindowFocus: false,
			staleTime: 60_000,
			initialPageParam: undefined,
			getNextPageParam: (lastPage) => {
				return lastPage?.pagination?.hasMore
					? lastPage.pagination.nextCursor
					: undefined;
			},
		},
	);

	const logs = useMemo(
		() =>
			(data?.pages.flatMap((page) => page?.logs ?? []) ?? []).filter(
				(log) => !log.retriedByLogId,
			),
		[data],
	);

	const modelBreakdown = useMemo(() => computeModelBreakdown(logs), [logs]);

	const sentinelRef = useRef<HTMLDivElement | null>(null);

	// Auto-load the next page when the sentinel scrolls into view.
	useEffect(() => {
		const node = sentinelRef.current;
		if (!node || !hasNextPage || isFetchingNextPage) {
			return;
		}
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries[0]?.isIntersecting) {
					void fetchNextPage();
				}
			},
			{ rootMargin: "400px" },
		);
		observer.observe(node);
		return () => observer.disconnect();
	}, [hasNextPage, isFetchingNextPage, fetchNextPage]);

	const fetchClient = useFetchClient();
	const [isExporting, setIsExporting] = useState(false);

	const handleExportCsv = useCallback(async () => {
		setIsExporting(true);
		try {
			// Pages already loaded via the infinite query are reused to avoid
			// re-fetching them; remaining pages are fetched directly. Any failed
			// page fetch aborts the export so a partial CSV is never downloaded.
			const pages = data?.pages ?? [];
			const collected: ApiLog[] = pages.flatMap((page) => page?.logs ?? []);
			const lastPage = pages[pages.length - 1];
			let cursor = lastPage?.pagination?.hasMore
				? (lastPage.pagination.nextCursor ?? undefined)
				: undefined;
			while (cursor) {
				const res = await fetchClient.GET("/logs", {
					params: {
						query: { ...logsQuery, cursor },
					},
				});
				const body = res.data;
				if (!body) {
					throw new Error("Failed to fetch logs for export");
				}
				collected.push(...body.logs);
				cursor = body.pagination.hasMore
					? (body.pagination.nextCursor ?? undefined)
					: undefined;
			}
			const csv = buildLogsCsv(collected.filter((log) => !log.retriedByLogId));
			const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
			const url = URL.createObjectURL(blob);
			const a = document.createElement("a");
			a.href = url;
			a.download = `${agent.id}-requests-${timeRange}.csv`;
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			URL.revokeObjectURL(url);
		} catch {
			toast.error(
				"Could not fetch all requests for this period. Please try again.",
			);
		} finally {
			setIsExporting(false);
		}
	}, [data, fetchClient, logsQuery, agent.id, timeRange]);

	// The window total comes from the hourly rollup, whose hour-bucket
	// boundaries can drift slightly from the exact log window — never show a
	// total below the number of logs actually loaded.
	const requestTotal = Math.max(totals?.requestCount ?? 0, logs.length);

	return (
		<div className="space-y-4">
			<div className="flex flex-wrap items-center gap-4 rounded-xl border bg-card p-5">
				<div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-muted">
					<Icon className="h-6 w-6" />
				</div>
				<div className="min-w-0 flex-1">
					<h3 className="text-lg font-semibold tracking-tight">
						{agent.label}
					</h3>
					<div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
						<span>
							{logs.length.toLocaleString()} of {requestTotal.toLocaleString()}{" "}
							request{requestTotal !== 1 ? "s" : ""}
						</span>
						<span className="text-border">·</span>
						<span>${(totals?.totalCost ?? 0).toFixed(2)} this period</span>
						<span className="text-border">·</span>
						<span>{formatTokens(totals?.totalTokens ?? 0)} tokens</span>
					</div>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<TimeRangePicker value={timeRange} onChange={updateTimeRange} />
					<button
						type="button"
						onClick={handleExportCsv}
						disabled={isExporting || logs.length === 0}
						className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/50 disabled:opacity-50"
						title="Export all requests in this period to CSV"
					>
						{isExporting ? (
							<Loader2 className="h-3.5 w-3.5 animate-spin" />
						) : (
							<Download className="h-3.5 w-3.5" />
						)}
						{isExporting ? "Exporting..." : "Export CSV"}
					</button>
				</div>
			</div>
			{logsLoading ? (
				<div className="flex h-[360px] items-center justify-center rounded-xl border bg-card/50">
					<Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
				</div>
			) : logsError ? (
				<div className="rounded-xl border border-destructive/30 bg-destructive/5 p-8 text-center">
					<h3 className="text-base font-semibold tracking-tight">
						Couldn&apos;t load usage
					</h3>
					<p className="mx-auto mt-1.5 max-w-md text-sm text-muted-foreground">
						Something went wrong fetching {agent.label} data. Refresh the page
						to try again.
					</p>
				</div>
			) : logs.length === 0 && !hasNextPage ? (
				<div className="rounded-xl border bg-card/50 p-8 text-center">
					<div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
						<Icon className="h-5 w-5 text-muted-foreground" />
					</div>
					<h3 className="text-base font-semibold tracking-tight">
						No activity for {agent.label}
					</h3>
					<p className="mx-auto mt-1.5 max-w-md text-sm text-muted-foreground">
						We haven&apos;t seen any requests from this agent in this period.
						Run it with your DevPass key or pick a longer time range.
					</p>
				</div>
			) : (
				<>
					<AgentModelUsageChart projectId={projectId} />
					<ModelUsageBreakdown models={modelBreakdown} />
					<div className="overflow-hidden rounded-xl border">
						<div className="border-b bg-muted/30 px-4 py-2.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
							Requests
						</div>
						<div className="divide-y">
							{logs.map((log) => (
								<RequestRow key={log.id} log={log} />
							))}
						</div>
						{/* Auto-load sentinel: fetches the next page when scrolled into view. */}
						<div ref={sentinelRef} className="h-px" />
						{hasNextPage && (
							<div className="flex justify-center border-t p-3">
								<button
									type="button"
									onClick={() => fetchNextPage()}
									disabled={isFetchingNextPage}
									className="rounded-md border px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/50 disabled:opacity-50"
								>
									{isFetchingNextPage ? "Loading more..." : "Load more"}
								</button>
							</div>
						)}
					</div>
				</>
			)}
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

	const isLoading = userLoading || statusLoading;

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
			) : statusError ? (
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
			) : (
				<AgentDetailBody agent={agent} orgId={orgId} projectId={projectId} />
			)}
		</div>
	);
}
