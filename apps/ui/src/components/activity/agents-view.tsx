"use client";

import {
	ArrowLeft,
	ChevronDown,
	ChevronRight,
	Clock,
	Coins,
	Cpu,
	Download,
	Terminal,
	X,
	Zap,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { LogCard } from "@/components/dashboard/log-card";
import {
	UsageModeSelector,
	useUsageMode,
} from "@/components/shared/usage-mode-selector";
import {
	TimeRangePicker,
	type TimeRangeValue,
} from "@/components/time-range-picker";
import { useDashboardNavigation } from "@/hooks/useDashboardNavigation";
import {
	AGENT_TIME_RANGE_HOURS,
	AGENT_TIME_RANGES,
	parseAgentTimeRange,
} from "@/lib/agent-time-ranges";
import { useToast } from "@/lib/components/use-toast";
import { useApi, useFetchClient } from "@/lib/fetch-client";
import { applyUsageMode } from "@/lib/usage-mode";
import { cn } from "@/lib/utils";

import { buildAgentLogsCsv, CODING_AGENTS } from "@llmgateway/shared";
import {
	AnthropicIcon,
	AnvilIcon,
	AutohandIcon,
	ClineIcon,
	CodexIcon,
	CursorIcon,
	DevPassCodeIcon,
	EmpryoIcon,
	GitHubCopilotIcon,
	N8nIcon,
	OpenClawIcon,
	OpenCodeIcon,
	SoulForgeIcon,
} from "@llmgateway/shared/components";
import {
	formatCompactNumber as formatTokens,
	formatNumber,
} from "@llmgateway/shared/number-format";

import type { paths } from "@/lib/api/v1";
import type {
	SourceActivityData,
	SourceModelUsage,
	SourceUsage,
} from "@/types/activity";
import type { Log } from "@llmgateway/db";
import type { ComponentType, ReactNode, SVGProps } from "react";

type ApiLog =
	paths["/logs"]["get"]["responses"][200]["content"]["application/json"]["logs"][number];

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

interface AgentDefinition {
	id: string;
	label: string;
	icon: IconComponent;
	sources: string[];
}

const AGENT_ICONS: Record<string, IconComponent> = {
	"devpass-code": DevPassCodeIcon,
	"claude.com/claude-code": AnthropicIcon,
	anvil: AnvilIcon,
	opencode: OpenCodeIcon,
	cursor: CursorIcon,
	autohand: AutohandIcon,
	empryo: EmpryoIcon,
	soulforge: SoulForgeIcon,
	cline: ClineIcon,
	"roo-code": ClineIcon,
	codex: CodexIcon,
	"github-copilot": GitHubCopilotIcon,
	n8n: N8nIcon,
	openclaw: OpenClawIcon,
};

const AGENTS: AgentDefinition[] = CODING_AGENTS.map((agent) => ({
	id: agent.id,
	label: agent.label,
	icon: AGENT_ICONS[agent.id] ?? Terminal,
	sources: agent.xSourceValues,
}));

interface UsageShare {
	requestCount: number;
	cost: number;
	totalTokens: number;
}

interface AgentModelUsage extends UsageShare {
	model: string;
}

interface AgentStats {
	agent: AgentDefinition;
	requestCount: number;
	totalCost: number;
	totalTokens: number;
	totalPromptTokens: number;
	totalCompletionTokens: number;
	lastActive: Date | null;
	models: AgentModelUsage[];
}

interface ModelAgentUsage extends UsageShare {
	agent: AgentDefinition;
}

interface ModelStats {
	model: string;
	requestCount: number;
	totalCost: number;
	totalTokens: number;
	agents: ModelAgentUsage[];
}

type AgentsViewMode = "agents" | "models";

function parseViewMode(value: string | null): AgentsViewMode {
	return value === "models" ? "models" : "agents";
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

function getTimeRangeWindow(timeRange: TimeRangeValue): {
	from: Date;
	to: Date;
} {
	const to = new Date();
	const windowMs = AGENT_TIME_RANGE_HOURS[timeRange] * 60 * 60 * 1000;
	const from = new Date(to.getTime() - windowMs);
	return { from, to };
}

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

function formatLastActive(date: Date | null): string {
	if (!date) {
		return "—";
	}
	const now = new Date();
	const diff = now.getTime() - date.getTime();
	const minutes = Math.floor(diff / (1000 * 60));
	const hours = Math.floor(diff / (1000 * 60 * 60));
	const days = Math.floor(diff / (1000 * 60 * 60 * 24));

	if (minutes < 60) {
		return "Recently";
	}
	if (hours < 24) {
		return `${hours}h ago`;
	}
	if (days < 7) {
		return `${days}d ago`;
	}
	return date.toLocaleDateString();
}

function findAgent(source: string): AgentDefinition | undefined {
	return AGENTS.find((agent) => agent.sources.includes(source));
}

function byCostThenRequests(a: UsageShare, b: UsageShare): number {
	return b.cost - a.cost || b.requestCount - a.requestCount;
}

function addUsage(target: UsageShare, row: SourceModelUsage) {
	target.requestCount += row.requestCount;
	target.cost += row.cost;
	target.totalTokens += row.totalTokens;
}

function computeAgentModels(
	agent: AgentDefinition,
	sourceModels: SourceModelUsage[],
): AgentModelUsage[] {
	const byModel = new Map<string, AgentModelUsage>();
	for (const row of sourceModels) {
		if (!agent.sources.includes(row.source)) {
			continue;
		}
		let entry = byModel.get(row.model);
		if (!entry) {
			entry = { model: row.model, requestCount: 0, cost: 0, totalTokens: 0 };
			byModel.set(row.model, entry);
		}
		addUsage(entry, row);
	}
	return Array.from(byModel.values())
		.filter((entry) => entry.requestCount > 0)
		.sort(byCostThenRequests);
}

function computeModelStats(sourceModels: SourceModelUsage[]): ModelStats[] {
	const byModel = new Map<
		string,
		{ total: UsageShare; agents: Map<string, ModelAgentUsage> }
	>();
	for (const row of sourceModels) {
		const agent = findAgent(row.source);
		if (!agent || row.requestCount === 0) {
			continue;
		}
		let entry = byModel.get(row.model);
		if (!entry) {
			entry = {
				total: { requestCount: 0, cost: 0, totalTokens: 0 },
				agents: new Map(),
			};
			byModel.set(row.model, entry);
		}
		addUsage(entry.total, row);
		let agentEntry = entry.agents.get(agent.id);
		if (!agentEntry) {
			agentEntry = { agent, requestCount: 0, cost: 0, totalTokens: 0 };
			entry.agents.set(agent.id, agentEntry);
		}
		addUsage(agentEntry, row);
	}
	return Array.from(byModel.entries())
		.map(([model, { total, agents }]) => ({
			model,
			requestCount: total.requestCount,
			totalCost: total.cost,
			totalTokens: total.totalTokens,
			agents: Array.from(agents.values()).sort(byCostThenRequests),
		}))
		.sort(
			(a, b) => b.totalCost - a.totalCost || b.requestCount - a.requestCount,
		);
}

function computeAgentStats(
	sources: SourceUsage[],
	sourceModels: SourceModelUsage[],
): AgentStats[] {
	const stats: AgentStats[] = [];

	for (const agent of AGENTS) {
		const rows = sources.filter((row) => agent.sources.includes(row.source));
		const requestCount = rows.reduce((sum, row) => sum + row.requestCount, 0);
		if (requestCount === 0) {
			continue;
		}

		const lastActiveMs = rows.reduce((max, row) => {
			if (!row.lastUsedAt) {
				return max;
			}
			const t = new Date(row.lastUsedAt).getTime();
			return t > max ? t : max;
		}, 0);

		stats.push({
			agent,
			requestCount,
			totalCost: rows.reduce((sum, row) => sum + row.cost, 0),
			totalTokens: rows.reduce((sum, row) => sum + row.totalTokens, 0),
			totalPromptTokens: rows.reduce((sum, row) => sum + row.inputTokens, 0),
			totalCompletionTokens: rows.reduce(
				(sum, row) => sum + row.outputTokens,
				0,
			),
			lastActive: lastActiveMs > 0 ? new Date(lastActiveMs) : null,
			models: computeAgentModels(agent, sourceModels),
		});
	}

	return stats.sort((a, b) => b.totalCost - a.totalCost);
}

/**
 * Share of a breakdown row within its parent: by cost, or by requests when
 * the parent has no spend (e.g. free models).
 */
function shareOf(row: UsageShare, rows: UsageShare[]): number {
	const totalCost = rows.reduce((sum, r) => sum + r.cost, 0);
	if (totalCost > 0) {
		return row.cost / totalCost;
	}
	const totalRequests = rows.reduce((sum, r) => sum + r.requestCount, 0);
	return totalRequests > 0 ? row.requestCount / totalRequests : 0;
}

function formatShare(share: number): string {
	const percent = share * 100;
	if (percent > 0 && percent < 1) {
		return "<1%";
	}
	return `${Math.round(percent)}%`;
}

function ShareBar({ share }: { share: number }) {
	return (
		<div className="h-1 w-full overflow-hidden rounded-full bg-muted">
			<div
				className="h-full rounded-full bg-foreground/60"
				style={{ width: `${Math.max(share * 100, share > 0 ? 2 : 0)}%` }}
			/>
		</div>
	);
}

/** One labelled row of a cost-share breakdown. */
function BreakdownRow({
	label,
	row,
	share,
	onClick,
	active,
}: {
	label: ReactNode;
	row: UsageShare;
	share: number;
	onClick?: () => void;
	active?: boolean;
}) {
	const content = (
		<>
			<div className="flex items-center justify-between gap-3 text-xs">
				<div className="flex min-w-0 items-center gap-1.5">{label}</div>
				<div className="flex shrink-0 items-center gap-2 tabular-nums text-muted-foreground">
					<span>${row.cost.toFixed(2)}</span>
					<span className="w-8 text-right">{formatShare(share)}</span>
				</div>
			</div>
			<ShareBar share={share} />
		</>
	);

	if (!onClick) {
		return <div className="space-y-1">{content}</div>;
	}

	return (
		<button
			type="button"
			onClick={(event) => {
				event.stopPropagation();
				onClick();
			}}
			className={cn(
				"-mx-1.5 block w-[calc(100%+0.75rem)] space-y-1 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-muted/60",
				active && "bg-muted",
			)}
		>
			{content}
		</button>
	);
}

function ModelLabel({ model }: { model: string }) {
	return (
		<span className="truncate font-mono text-[11px]" title={model}>
			{model}
		</span>
	);
}

const CARD_BREAKDOWN_ROWS = 3;

function ViewModeToggle({
	value,
	onChange,
}: {
	value: AgentsViewMode;
	onChange: (value: AgentsViewMode) => void;
}) {
	const options: { value: AgentsViewMode; label: string }[] = [
		{ value: "agents", label: "Agents" },
		{ value: "models", label: "Models" },
	];

	return (
		<div
			className="inline-flex items-center rounded-lg border border-border/60 bg-muted/40 p-0.5"
			role="group"
			aria-label="Group usage by"
		>
			{options.map((option) => (
				<button
					key={option.value}
					type="button"
					onClick={() => onChange(option.value)}
					aria-pressed={value === option.value}
					className={cn(
						"rounded-md px-3 py-1 text-xs font-medium transition-colors",
						value === option.value
							? "bg-background text-foreground shadow-sm"
							: "text-muted-foreground hover:text-foreground",
					)}
				>
					{option.label}
				</button>
			))}
		</div>
	);
}

function AgentCard({
	stats,
	onClick,
	onModelClick,
}: {
	stats: AgentStats;
	onClick: () => void;
	onModelClick: (model: string) => void;
}) {
	const topModels = stats.models.slice(0, CARD_BREAKDOWN_ROWS);
	const hiddenModels = stats.models.length - topModels.length;

	const Icon = stats.agent.icon;

	return (
		<div
			role="button"
			tabIndex={0}
			className="group relative w-full cursor-pointer overflow-hidden rounded-xl border border-border/60 bg-card p-5 text-left transition-all duration-200 hover:border-foreground/15 hover:shadow-lg"
			onClick={onClick}
			onKeyDown={(event) => {
				if (
					event.target === event.currentTarget &&
					(event.key === "Enter" || event.key === " ")
				) {
					event.preventDefault();
					onClick();
				}
			}}
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
			{topModels.length > 0 && (
				<div className="mt-3 space-y-1 border-t border-border/40 pt-3">
					<p className="text-[11px] uppercase tracking-wider text-muted-foreground/60">
						Models
					</p>
					{topModels.map((model) => (
						<BreakdownRow
							key={model.model}
							label={<ModelLabel model={model.model} />}
							row={model}
							share={shareOf(model, stats.models)}
							onClick={() => onModelClick(model.model)}
						/>
					))}
					{hiddenModels > 0 && (
						<p className="pt-0.5 text-[11px] text-muted-foreground">
							+{hiddenModels} more model{hiddenModels !== 1 ? "s" : ""}
						</p>
					)}
				</div>
			)}
		</div>
	);
}

function ModelCard({
	stats,
	onAgentClick,
}: {
	stats: ModelStats;
	onAgentClick: (agentId: string) => void;
}) {
	return (
		<div className="rounded-xl border border-border/60 bg-card p-5">
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0">
					<h3
						className="truncate font-mono text-sm font-semibold tracking-tight"
						title={stats.model}
					>
						{stats.model}
					</h3>
					<p className="mt-1 text-2xl font-bold tracking-tight tabular-nums">
						${stats.totalCost.toFixed(2)}
					</p>
				</div>
				<div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
					<Cpu className="h-5 w-5" />
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
						Agents
					</p>
					<p className="text-sm font-medium tabular-nums">
						{formatNumber(stats.agents.length)}
					</p>
				</div>
			</div>
			<div className="mt-3 space-y-1 border-t border-border/40 pt-3">
				{stats.agents.map((usage) => (
					<BreakdownRow
						key={usage.agent.id}
						label={
							<>
								<usage.agent.icon className="h-3.5 w-3.5 shrink-0" />
								<span className="truncate">{usage.agent.label}</span>
							</>
						}
						row={usage}
						share={shareOf(usage, stats.agents)}
						onClick={() => onAgentClick(usage.agent.id)}
					/>
				))}
			</div>
		</div>
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
							{formatNumber(session.totalTokens)}
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
	timeRange,
	modelFilter,
	onModelFilterChange,
	onBack,
}: {
	stats: AgentStats;
	orgId: string;
	projectId: string;
	timeRange: TimeRangeValue;
	modelFilter: string | null;
	onModelFilterChange: (model: string | null) => void;
	onBack: () => void;
}) {
	const Icon = stats.agent.icon;
	const api = useApi();

	const range = useMemo(() => {
		const { from, to } = getTimeRangeWindow(timeRange);
		return { from: from.toISOString(), to: to.toISOString() };
	}, [timeRange]);

	const logsQuery = useMemo(
		() => ({
			orderBy: "createdAt_desc" as const,
			projectId,
			limit: "100",
			source: stats.agent.sources.join(","),
			startDate: range.from,
			endDate: range.to,
			...(modelFilter ? { model: modelFilter } : {}),
		}),
		[projectId, stats.agent.sources, range.from, range.to, modelFilter],
	);

	const filteredModel = modelFilter
		? stats.models.find((m) => m.model === modelFilter)
		: undefined;
	const expectedRequests = filteredModel
		? filteredModel.requestCount
		: stats.requestCount;

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
				query: logsQuery,
			},
		},
		{
			refetchOnWindowFocus: false,
			staleTime: 5 * 60 * 1000,
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

	const sessions = useMemo(() => groupLogsIntoSessions(logs), [logs]);

	const sentinelRef = useRef<HTMLDivElement | null>(null);

	// Auto-load next page when the sentinel scrolls into view.
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
	const { toast } = useToast();
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
			const csv = buildAgentLogsCsv(
				collected.filter((log) => !log.retriedByLogId),
			);
			const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
			const url = URL.createObjectURL(blob);
			const a = document.createElement("a");
			a.href = url;
			a.download = `${stats.agent.id}${modelFilter ? `-${modelFilter}` : ""}-requests-${timeRange}.csv`;
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			URL.revokeObjectURL(url);
		} catch {
			toast({
				title: "Export failed",
				description:
					"Could not fetch all requests for this period. Please try again.",
				variant: "destructive",
			});
		} finally {
			setIsExporting(false);
		}
	}, [
		data,
		fetchClient,
		logsQuery,
		stats.agent.id,
		modelFilter,
		timeRange,
		toast,
	]);

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

			<div className="flex items-center justify-between gap-4 pb-2">
				<div className="flex items-center gap-4">
					<div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-muted">
						<Icon className="h-6 w-6" />
					</div>
					<div>
						<h3 className="text-lg font-semibold tracking-tight">
							{stats.agent.label}
						</h3>
						<div className="flex items-center gap-3 text-sm text-muted-foreground">
							<span>
								{formatNumber(logs.length)} of {formatNumber(expectedRequests)}{" "}
								request
								{expectedRequests !== 1 ? "s" : ""}
							</span>
							<span className="text-border">&middot;</span>
							<span>${stats.totalCost.toFixed(2)}</span>
							<span className="text-border">&middot;</span>
							<span>{formatTokens(stats.totalTokens)} tokens</span>
						</div>
					</div>
				</div>
				<button
					type="button"
					onClick={handleExportCsv}
					disabled={isExporting || logs.length === 0}
					className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/50 disabled:opacity-50"
					title="Export all requests in this period to CSV"
				>
					<Download className="h-4 w-4" />
					{isExporting ? "Exporting..." : "Export CSV"}
				</button>
			</div>

			{stats.models.length > 0 && (
				<div className="rounded-lg border bg-card p-4">
					<div className="mb-2 flex items-center justify-between">
						<h4 className="text-sm font-medium">Models</h4>
						<p className="text-xs text-muted-foreground">
							Select a model to filter sessions
						</p>
					</div>
					<div className="grid gap-x-6 gap-y-1 md:grid-cols-2">
						{stats.models.map((model) => (
							<BreakdownRow
								key={model.model}
								label={
									<>
										<ModelLabel model={model.model} />
										<span className="shrink-0 text-muted-foreground tabular-nums">
											{formatNumber(model.requestCount)} req
										</span>
									</>
								}
								row={model}
								share={shareOf(model, stats.models)}
								active={modelFilter === model.model}
								onClick={() =>
									onModelFilterChange(
										modelFilter === model.model ? null : model.model,
									)
								}
							/>
						))}
					</div>
				</div>
			)}

			{modelFilter && (
				<div className="flex items-center gap-2 text-sm">
					<span className="text-muted-foreground">Showing sessions for</span>
					<button
						type="button"
						onClick={() => onModelFilterChange(null)}
						className="inline-flex items-center gap-1 rounded-md border bg-muted/50 px-2 py-0.5 font-mono text-xs transition-colors hover:bg-muted"
						title="Clear model filter"
					>
						{modelFilter}
						<X className="h-3 w-3" />
					</button>
				</div>
			)}

			<div className="space-y-3">
				{isLoading ? (
					<div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
						<div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground/20 border-t-muted-foreground/70" />
						<span>Loading sessions...</span>
					</div>
				) : error ? (
					<div className="py-8 text-center text-sm text-destructive">
						Failed to load sessions. Please try again.
					</div>
				) : sessions.length === 0 ? (
					<div className="py-8 text-center text-sm text-muted-foreground">
						No sessions found for this {modelFilter ? "model" : "agent"}.
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

				{/* Auto-load sentinel: fetches the next page when scrolled into view. */}
				<div ref={sentinelRef} className="h-1" />
				{hasNextPage && (
					<div className="flex justify-center pt-2">
						<button
							type="button"
							onClick={() => fetchNextPage()}
							disabled={isFetchingNextPage}
							className="rounded-md border px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/50 disabled:opacity-50"
						>
							{isFetchingNextPage ? "Loading more..." : "Load more sessions"}
						</button>
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
				Activity appears when coding agents like DevPass Code, Claude Code,
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
	initialData?: SourceActivityData;
}) {
	const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
	const [modelFilter, setModelFilter] = useState<string | null>(null);
	const router = useRouter();
	const searchParams = useSearchParams();
	const { buildUrl } = useDashboardNavigation();
	const api = useApi();
	const usageMode = useUsageMode();

	const timeRange = parseAgentTimeRange(searchParams.get("timeRange"));
	const viewMode = parseViewMode(searchParams.get("view"));

	const updateTimeRange = (newTimeRange: TimeRangeValue) => {
		const params = new URLSearchParams(searchParams);
		params.set("timeRange", newTimeRange);
		router.push(`${buildUrl("agents")}?${params.toString()}`);
	};

	const updateViewMode = (next: AgentsViewMode) => {
		const params = new URLSearchParams(searchParams);
		if (next === "agents") {
			params.delete("view");
		} else {
			params.set("view", next);
		}
		const query = params.toString();
		router.replace(
			query ? `${buildUrl("agents")}?${query}` : buildUrl("agents"),
			{ scroll: false },
		);
	};

	const openAgent = (agentId: string, model: string | null = null) => {
		setSelectedAgentId(agentId);
		setModelFilter(model);
		if (viewMode !== "agents") {
			updateViewMode("agents");
		}
	};

	const { data, isLoading, error } = api.useQuery(
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
			enabled: !!projectId,
			refetchOnWindowFocus: false,
			staleTime: 5 * 60 * 1000,
			initialData,
		},
	);

	const sourceModels = useMemo(
		() =>
			(data?.sourceModels ?? []).map((row) => applyUsageMode(row, usageMode)),
		[data, usageMode],
	);

	const agentStats = useMemo(
		() =>
			computeAgentStats(
				(data?.sources ?? []).map((row) => applyUsageMode(row, usageMode)),
				sourceModels,
			),
		[data, usageMode, sourceModels],
	);

	const modelStats = useMemo(
		() => computeModelStats(sourceModels),
		[sourceModels],
	);

	const selectedStats =
		viewMode === "agents" && selectedAgentId
			? agentStats.find((s) => s.agent.id === selectedAgentId)
			: null;

	const totalCost = agentStats.reduce((sum, s) => sum + s.totalCost, 0);
	const totalRequests = agentStats.reduce((sum, s) => sum + s.requestCount, 0);

	return (
		<div className="space-y-6">
			<div className="flex flex-wrap items-center justify-between gap-4">
				<div className="flex flex-wrap items-center gap-3">
					<TimeRangePicker
						value={timeRange}
						onChange={updateTimeRange}
						allowedValues={AGENT_TIME_RANGES}
					/>
					<UsageModeSelector />
					<ViewModeToggle value={viewMode} onChange={updateViewMode} />
				</div>
				{!selectedStats && agentStats.length > 0 && (
					<div className="flex items-center gap-3 text-sm text-muted-foreground">
						{viewMode === "models" ? (
							<span>
								{modelStats.length} model
								{modelStats.length !== 1 ? "s" : ""}
							</span>
						) : (
							<span>
								{agentStats.length} agent
								{agentStats.length !== 1 ? "s" : ""}
							</span>
						)}
						<span className="text-border">&middot;</span>
						<span>{formatNumber(totalRequests)} requests</span>
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
					timeRange={timeRange}
					modelFilter={modelFilter}
					onModelFilterChange={setModelFilter}
					onBack={() => {
						setSelectedAgentId(null);
						setModelFilter(null);
					}}
				/>
			) : agentStats.length === 0 ? (
				<EmptyState />
			) : viewMode === "models" ? (
				modelStats.length === 0 ? (
					<div className="py-8 text-center text-sm text-muted-foreground">
						No per-model agent usage in this period yet.
					</div>
				) : (
					<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
						{modelStats.map((stats) => (
							<ModelCard
								key={stats.model}
								stats={stats}
								onAgentClick={(agentId) => openAgent(agentId, stats.model)}
							/>
						))}
					</div>
				)
			) : (
				<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
					{agentStats.map((stats) => (
						<AgentCard
							key={stats.agent.id}
							stats={stats}
							onClick={() => openAgent(stats.agent.id)}
							onModelClick={(model) => openAgent(stats.agent.id, model)}
						/>
					))}
				</div>
			)}
		</div>
	);
}
