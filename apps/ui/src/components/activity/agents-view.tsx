"use client";

import {
	ArrowLeft,
	ChevronDown,
	ChevronRight,
	Clock,
	Coins,
	Cpu,
	Terminal,
	Zap,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";

import { LogCard } from "@/components/dashboard/log-card";
import {
	DateRangePicker,
	getDateRangeFromParams,
} from "@/components/date-range-picker";
import { useDashboardNavigation } from "@/hooks/useDashboardNavigation";
import { Button } from "@/lib/components/button";
import { useApi } from "@/lib/fetch-client";

import {
	AnthropicIcon,
	AutohandIcon,
	ClineIcon,
	CodexIcon,
	CursorIcon,
	N8nIcon,
	OpenClawIcon,
	OpenCodeIcon,
	SoulForgeIcon,
} from "@llmgateway/shared/components";

import type { paths } from "@/lib/api/v1";
import type { LogsData } from "@/types/activity";
import type { Log } from "@llmgateway/db";
import type { ComponentType, SVGProps } from "react";

type ApiLog =
	paths["/logs"]["get"]["responses"][200]["content"]["application/json"]["logs"][number];

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

interface AgentDefinition {
	id: string;
	label: string;
	icon: IconComponent;
	sources: string[];
}

const AGENTS: AgentDefinition[] = [
	{
		id: "claude-code",
		label: "Claude Code",
		icon: AnthropicIcon,
		sources: ["claude.com/claude-code"],
	},
	{
		id: "opencode",
		label: "OpenCode",
		icon: OpenCodeIcon,
		sources: ["opencode", "open-code"],
	},
	{
		id: "cursor",
		label: "Cursor",
		icon: CursorIcon,
		sources: ["cursor"],
	},
	{
		id: "autohand",
		label: "Autohand Code",
		icon: AutohandIcon,
		sources: ["autohand"],
	},
	{
		id: "soulforge",
		label: "SoulForge",
		icon: SoulForgeIcon,
		sources: ["soulforge"],
	},
	{
		id: "cline",
		label: "Cline",
		icon: ClineIcon,
		sources: ["cline"],
	},
	{
		id: "codex",
		label: "Codex CLI",
		icon: CodexIcon,
		sources: ["codex"],
	},
	{
		id: "n8n",
		label: "n8n",
		icon: N8nIcon,
		sources: ["n8n"],
	},
	{
		id: "openclaw",
		label: "OpenClaw",
		icon: OpenClawIcon,
		sources: ["openclaw"],
	},
];

const ALL_SOURCES = AGENTS.flatMap((a) => a.sources);

interface AgentStats {
	agent: AgentDefinition;
	requestCount: number;
	totalCost: number;
	totalTokens: number;
	totalPromptTokens: number;
	totalCompletionTokens: number;
	lastActive: Date;
	logs: ApiLog[];
}

interface Session {
	id: string;
	startTime: Date;
	endTime: Date;
	logs: ApiLog[];
	totalCost: number;
	totalTokens: number;
	duration: number;
}

const SESSION_GAP_MS = 30 * 60 * 1000;

function toUiLog(log: ApiLog): Partial<Log> {
	return {
		...log,
		createdAt: new Date(log.createdAt),
		updatedAt: new Date(log.updatedAt),
		lastVideoDownloadedAt: log.lastVideoDownloadedAt
			? new Date(log.lastVideoDownloadedAt)
			: null,
		videoDownloadCount: log.videoDownloadCount ?? undefined,
		toolChoice: log.toolChoice as Log["toolChoice"],
		customHeaders: log.customHeaders as Log["customHeaders"],
	};
}

function buildSession(logs: ApiLog[], index: number): Session {
	const startTime = new Date(logs[0].createdAt);
	const endTime = new Date(logs[logs.length - 1].createdAt);

	return {
		id: `session-${index}`,
		startTime,
		endTime,
		logs: [...logs].reverse(),
		totalCost: logs.reduce((sum, log) => sum + (log.cost ?? 0), 0),
		totalTokens: logs.reduce(
			(sum, log) => sum + Number(log.totalTokens ?? 0),
			0,
		),
		duration: endTime.getTime() - startTime.getTime(),
	};
}

function groupLogsIntoSessions(logs: ApiLog[]): Session[] {
	if (logs.length === 0) {
		return [];
	}

	const sorted = [...logs].sort(
		(a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
	);

	const sessions: Session[] = [];
	let currentBatch: ApiLog[] = [sorted[0]];

	for (let i = 1; i < sorted.length; i++) {
		const prevTime = new Date(sorted[i - 1].createdAt).getTime();
		const currTime = new Date(sorted[i].createdAt).getTime();

		if (currTime - prevTime > SESSION_GAP_MS) {
			sessions.push(buildSession(currentBatch, sessions.length));
			currentBatch = [sorted[i]];
		} else {
			currentBatch.push(sorted[i]);
		}
	}

	if (currentBatch.length > 0) {
		sessions.push(buildSession(currentBatch, sessions.length));
	}

	return sessions.reverse();
}

function formatDuration(ms: number): string {
	const seconds = Math.floor(ms / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);

	if (hours > 0) {
		return `${hours}h ${minutes % 60}m`;
	}
	if (minutes > 0) {
		return `${minutes}m ${seconds % 60}s`;
	}
	return `${seconds}s`;
}

function formatTokens(count: number): string {
	if (count >= 1_000_000) {
		return `${(count / 1_000_000).toFixed(1)}M`;
	}
	if (count >= 1_000) {
		return `${(count / 1_000).toFixed(1)}K`;
	}
	return count.toLocaleString();
}

function formatLastActive(date: Date): string {
	const now = new Date();
	const diff = now.getTime() - date.getTime();
	const minutes = Math.floor(diff / (1000 * 60));
	const hours = Math.floor(diff / (1000 * 60 * 60));
	const days = Math.floor(diff / (1000 * 60 * 60 * 24));

	if (minutes < 1) {
		return "Just now";
	}
	if (minutes < 60) {
		return `${minutes}m ago`;
	}
	if (hours < 24) {
		return `${hours}h ago`;
	}
	if (days < 7) {
		return `${days}d ago`;
	}
	return date.toLocaleDateString();
}

function computeAgentStats(logs: ApiLog[]): AgentStats[] {
	const stats: AgentStats[] = [];

	for (const agent of AGENTS) {
		const agentLogs = logs.filter(
			(log) => log.source && agent.sources.includes(log.source),
		);
		if (agentLogs.length === 0) {
			continue;
		}

		const sorted = [...agentLogs].sort(
			(a, b) =>
				new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
		);

		stats.push({
			agent,
			requestCount: agentLogs.length,
			totalCost: agentLogs.reduce((sum, log) => sum + (log.cost ?? 0), 0),
			totalTokens: agentLogs.reduce(
				(sum, log) => sum + Number(log.totalTokens ?? 0),
				0,
			),
			totalPromptTokens: agentLogs.reduce(
				(sum, log) => sum + Number(log.promptTokens ?? 0),
				0,
			),
			totalCompletionTokens: agentLogs.reduce(
				(sum, log) => sum + Number(log.completionTokens ?? 0),
				0,
			),
			lastActive: new Date(sorted[0].createdAt),
			logs: agentLogs,
		});
	}

	return stats.sort((a, b) => b.totalCost - a.totalCost);
}

function AgentCard({
	stats,
	onClick,
}: {
	stats: AgentStats;
	onClick: () => void;
}) {
	const Icon = stats.agent.icon;

	return (
		<button
			type="button"
			className="group relative w-full overflow-hidden rounded-xl border border-border/60 bg-card p-5 text-left transition-all duration-200 hover:border-foreground/15 hover:shadow-lg"
			onClick={onClick}
		>
			<div className="flex items-start gap-4">
				<div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-muted transition-colors group-hover:bg-muted/80">
					<Icon className="h-6 w-6" />
				</div>
				<div className="flex-1 min-w-0">
					<div className="flex items-center justify-between">
						<h3 className="text-sm font-semibold tracking-tight">
							{stats.agent.label}
						</h3>
						<ChevronRight className="h-4 w-4 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5 group-hover:text-muted-foreground" />
					</div>
					<p className="text-2xl font-bold tracking-tight mt-1 tabular-nums">
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
						{stats.requestCount.toLocaleString()}
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

function SessionCard({
	session,
	orgId,
	projectId,
}: {
	session: Session;
	orgId: string;
	projectId: string;
}) {
	const [expanded, setExpanded] = useState(false);

	return (
		<div className="rounded-lg border bg-card">
			<button
				type="button"
				className="w-full p-4 text-left hover:bg-muted/50 transition-colors"
				onClick={() => setExpanded(!expanded)}
			>
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-2">
						{expanded ? (
							<ChevronDown className="h-4 w-4 text-muted-foreground" />
						) : (
							<ChevronRight className="h-4 w-4 text-muted-foreground" />
						)}
						<div className="text-sm text-muted-foreground">
							{session.startTime.toLocaleDateString()}{" "}
							{session.startTime.toLocaleTimeString()} &ndash;{" "}
							{session.endTime.toLocaleTimeString()}
						</div>
					</div>
					<div className="flex items-center gap-4 text-sm text-muted-foreground">
						<div className="flex items-center gap-1" title="Requests">
							<Zap className="h-3.5 w-3.5" />
							{session.logs.length}
						</div>
						<div className="flex items-center gap-1" title="Total tokens">
							<Cpu className="h-3.5 w-3.5" />
							{session.totalTokens.toLocaleString()}
						</div>
						<div className="flex items-center gap-1" title="Duration">
							<Clock className="h-3.5 w-3.5" />
							{formatDuration(session.duration)}
						</div>
						<div className="flex items-center gap-1" title="Cost">
							<Coins className="h-3.5 w-3.5" />${session.totalCost.toFixed(4)}
						</div>
					</div>
				</div>
			</button>
			{expanded && (
				<div className="border-t p-4 space-y-2">
					{session.logs.map((log) => (
						<LogCard
							key={log.id}
							log={toUiLog(log)}
							orgId={orgId}
							projectId={projectId}
						/>
					))}
				</div>
			)}
		</div>
	);
}

function AgentDetail({
	stats,
	orgId,
	projectId,
	onBack,
	isFetchingNextPage,
}: {
	stats: AgentStats;
	orgId: string;
	projectId: string;
	onBack: () => void;
	isFetchingNextPage: boolean;
}) {
	const Icon = stats.agent.icon;
	const sessions = useMemo(
		() => groupLogsIntoSessions(stats.logs),
		[stats.logs],
	);

	return (
		<div className="space-y-4">
			<button
				type="button"
				className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
				onClick={onBack}
			>
				<ArrowLeft className="h-4 w-4" />
				Back to agents
			</button>

			<div className="flex items-center gap-4 pb-2">
				<div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-muted">
					<Icon className="h-6 w-6" />
				</div>
				<div>
					<h3 className="text-lg font-semibold tracking-tight">
						{stats.agent.label}
					</h3>
					<div className="flex items-center gap-3 text-sm text-muted-foreground">
						<span>
							{stats.requestCount.toLocaleString()} request
							{stats.requestCount !== 1 ? "s" : ""}
						</span>
						<span className="text-border">&middot;</span>
						<span>${stats.totalCost.toFixed(2)}</span>
						<span className="text-border">&middot;</span>
						<span>{formatTokens(stats.totalTokens)} tokens</span>
					</div>
				</div>
			</div>

			<div className="space-y-3">
				{sessions.length === 0 ? (
					<div className="py-8 text-center text-sm text-muted-foreground">
						No sessions found for this agent.
					</div>
				) : (
					sessions.map((session) => (
						<SessionCard
							key={session.id}
							session={session}
							orgId={orgId}
							projectId={projectId}
						/>
					))
				)}

				{isFetchingNextPage && (
					<div className="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground">
						<div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground/20 border-t-muted-foreground/70" />
						<span>Loading more sessions...</span>
					</div>
				)}
			</div>
		</div>
	);
}

function EmptyState() {
	return (
		<div className="flex flex-col items-center justify-center py-16 px-4">
			<div className="relative mb-6">
				<div className="absolute -inset-3 rounded-full bg-muted/50 blur-md" />
				<div className="relative rounded-xl border border-border/60 bg-muted/30 p-4">
					<Terminal className="h-8 w-8 text-muted-foreground/70" />
				</div>
			</div>
			<h3 className="text-lg font-semibold tracking-tight mb-1.5">
				No agent activity yet
			</h3>
			<p className="text-sm text-muted-foreground max-w-sm text-center mb-6">
				Activity appears when coding agents like Claude Code, Autohand Code,
				OpenCode, Cursor, or Cline make API requests through the gateway.
			</p>
			<div className="flex flex-wrap items-center justify-center gap-4">
				{AGENTS.slice(0, 5).map((agent) => (
					<div
						key={agent.id}
						className="flex items-center gap-2 rounded-lg border border-border/40 bg-muted/20 px-3 py-2"
					>
						<agent.icon className="h-4 w-4 text-muted-foreground/60" />
						<span className="text-xs text-muted-foreground/60">
							{agent.label}
						</span>
					</div>
				))}
			</div>
		</div>
	);
}

export function AgentsView({
	projectId,
	orgId,
	initialData,
}: {
	projectId: string;
	orgId: string;
	initialData?: LogsData;
}) {
	const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
	const searchParams = useSearchParams();
	const { buildUrl } = useDashboardNavigation();
	const api = useApi();

	const { from, to } = getDateRangeFromParams(searchParams);

	const queryParams: Record<string, string> = {
		orderBy: "createdAt_desc",
		projectId,
		limit: "100",
		source: ALL_SOURCES.join(","),
		startDate: from.toISOString(),
		endDate: to.toISOString(),
	};

	const {
		data,
		isLoading,
		error,
		fetchNextPage,
		hasNextPage,
		isFetchingNextPage,
	} = api.useInfiniteQuery(
		"get",
		"/logs",
		{
			params: {
				query: queryParams,
			},
		},
		{
			enabled: !!projectId,
			refetchOnWindowFocus: false,
			staleTime: 5 * 60 * 1000,
			initialData: initialData
				? {
						pages: [initialData],
						pageParams: [undefined],
					}
				: undefined,
			initialPageParam: undefined,
			getNextPageParam: (lastPage) => {
				return lastPage?.pagination?.hasMore
					? lastPage.pagination.nextCursor
					: undefined;
			},
		},
	);

	const allLogs = useMemo(
		() =>
			(data?.pages.flatMap((page) => page?.logs ?? []) ?? []).filter(
				(log) => !log.retriedByLogId,
			),
		[data],
	);

	const agentStats = useMemo(() => computeAgentStats(allLogs), [allLogs]);

	const selectedStats = selectedAgentId
		? agentStats.find((s) => s.agent.id === selectedAgentId)
		: null;

	const totalCost = agentStats.reduce((sum, s) => sum + s.totalCost, 0);
	const totalRequests = agentStats.reduce((sum, s) => sum + s.requestCount, 0);

	return (
		<div className="space-y-6">
			<div className="flex flex-wrap items-center justify-between gap-4">
				<DateRangePicker buildUrl={buildUrl} path="agents" />
				{!selectedStats && agentStats.length > 0 && (
					<div className="flex items-center gap-3 text-sm text-muted-foreground">
						<span>
							{agentStats.length} agent
							{agentStats.length !== 1 ? "s" : ""}
						</span>
						<span className="text-border">&middot;</span>
						<span>{totalRequests.toLocaleString()} requests</span>
						<span className="text-border">&middot;</span>
						<span className="font-medium text-foreground">
							${totalCost.toFixed(2)}
						</span>
					</div>
				)}
			</div>

			{isLoading ? (
				<div className="flex flex-col items-center justify-center py-16">
					<div className="h-8 w-8 animate-spin rounded-full border-2 border-muted-foreground/20 border-t-muted-foreground/70" />
					<p className="mt-4 text-sm text-muted-foreground">
						Loading agents...
					</p>
				</div>
			) : error ? (
				<div className="py-8 text-center text-sm text-destructive">
					Failed to load agent data. Please try again.
				</div>
			) : selectedStats ? (
				<AgentDetail
					stats={selectedStats}
					orgId={orgId}
					projectId={projectId}
					onBack={() => setSelectedAgentId(null)}
					isFetchingNextPage={isFetchingNextPage}
				/>
			) : agentStats.length === 0 ? (
				<EmptyState />
			) : (
				<>
					<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
						{agentStats.map((stats) => (
							<AgentCard
								key={stats.agent.id}
								stats={stats}
								onClick={() => setSelectedAgentId(stats.agent.id)}
							/>
						))}
					</div>

					{hasNextPage && (
						<div className="flex justify-center pt-4">
							<Button
								onClick={() => fetchNextPage()}
								disabled={isFetchingNextPage}
								variant="outline"
							>
								{isFetchingNextPage ? "Loading more..." : "Load More"}
							</Button>
						</div>
					)}
				</>
			)}
		</div>
	);
}
