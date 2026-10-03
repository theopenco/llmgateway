"use client";

import { subMinutes } from "date-fns";
import {
	ArrowLeft,
	ChevronDown,
	ChevronRight,
	Clock,
	Coins,
	Cpu,
	Download,
	Terminal,
	Zap,
} from "lucide-react";
import { useState } from "react";

import {
	DEMO_AGENTS,
	DEMO_API_KEYS,
	DEMO_LOGS,
} from "@/components/home/dashboard-demo-data";
import { applyUsageModeToDaily, type UsageMode } from "@/lib/usage-mode";
import { cn } from "@/lib/utils";

import { CODING_AGENTS } from "@llmgateway/shared";
import {
	AnthropicIcon,
	ClineIcon,
	CodexIcon,
	CursorIcon,
	DevPassCodeIcon,
	OpenCodeIcon,
} from "@llmgateway/shared/components";
import {
	formatCompactNumber as formatTokens,
	formatNumber,
} from "@llmgateway/shared/number-format";

import { READ_ONLY_MESSAGE, useDemo } from "./context";
import {
	TimeRangeControl,
	UsageModeControl,
	type TimeRangeValue,
} from "./controls";
import { DemoLogCard } from "./log-card";
import { activityForRange } from "./time-range";

import type { DailyActivity } from "@/types/activity";
import type { ComponentType, ReactNode, SVGProps } from "react";

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;
type ViewMode = "agents" | "models";

const AGENT_ICONS: Record<string, IconComponent> = {
	"claude.com/claude-code": AnthropicIcon,
	"devpass-code": DevPassCodeIcon,
	cursor: CursorIcon,
	codex: CodexIcon,
	opencode: OpenCodeIcon,
	cline: ClineIcon,
};

const AGENT_TRAFFIC_SHARE =
	DEMO_API_KEYS.find((key) => key.id === "key_coding")?.share ?? 0;

interface UsageShare {
	requestCount: number;
	cost: number;
	totalTokens: number;
}

interface AgentStats extends UsageShare {
	id: string;
	label: string;
	icon: IconComponent;
	lastActiveMinutes: number;
	models: (UsageShare & { model: string })[];
}

interface ModelStats extends UsageShare {
	model: string;
	agents: (UsageShare & { agent: AgentStats })[];
}

function modelRates(activity: DailyActivity[]) {
	const totals = new Map<string, UsageShare>();
	for (const day of activity) {
		for (const row of day.modelBreakdown) {
			const current = totals.get(row.id) ?? {
				requestCount: 0,
				cost: 0,
				totalTokens: 0,
			};
			current.requestCount += row.requestCount;
			current.cost += row.cost;
			current.totalTokens += row.totalTokens;
			totals.set(row.id, current);
		}
	}
	return totals;
}

function buildAgentStats(activity: DailyActivity[]): AgentStats[] {
	const totalRequests = activity.reduce(
		(sum, day) => sum + day.requestCount,
		0,
	);
	const rates = modelRates(activity);
	return DEMO_AGENTS.map((agent) => {
		const agentRequests = totalRequests * AGENT_TRAFFIC_SHARE * agent.share;
		const models = Object.entries(agent.models)
			.map(([model, mix]) => {
				const rate = rates.get(model);
				const requestCount = Math.round(agentRequests * mix);
				const perRequest = (value: number) =>
					rate && rate.requestCount > 0 ? value / rate.requestCount : 0;
				return {
					model,
					requestCount,
					cost: requestCount * perRequest(rate?.cost ?? 0),
					totalTokens: Math.round(
						requestCount * perRequest(rate?.totalTokens ?? 0),
					),
				};
			})
			.sort((a, b) => b.cost - a.cost);
		const sum = (pick: (row: UsageShare) => number) =>
			models.reduce((total, row) => total + pick(row), 0);
		return {
			id: agent.id,
			label:
				CODING_AGENTS.find((definition) => definition.id === agent.id)?.label ??
				agent.id,
			icon: AGENT_ICONS[agent.id] ?? Terminal,
			lastActiveMinutes: agent.lastActiveMinutes,
			requestCount: sum((row) => row.requestCount),
			cost: sum((row) => row.cost),
			totalTokens: sum((row) => row.totalTokens),
			models,
		};
	})
		.filter((agent) => agent.requestCount > 0)
		.sort((a, b) => b.cost - a.cost);
}

function buildModelStats(agents: AgentStats[]): ModelStats[] {
	const byModel = new Map<string, ModelStats>();
	for (const agent of agents) {
		for (const row of agent.models) {
			const current = byModel.get(row.model) ?? {
				model: row.model,
				requestCount: 0,
				cost: 0,
				totalTokens: 0,
				agents: [],
			};
			current.requestCount += row.requestCount;
			current.cost += row.cost;
			current.totalTokens += row.totalTokens;
			current.agents.push({ ...row, agent });
			byModel.set(row.model, current);
		}
	}
	return Array.from(byModel.values()).sort((a, b) => b.cost - a.cost);
}

function shareOf(row: UsageShare, rows: UsageShare[]) {
	const total = rows.reduce((sum, item) => sum + item.cost, 0);
	return total > 0 ? row.cost / total : 0;
}

function formatShare(share: number) {
	const percent = share * 100;
	return percent > 0 && percent < 1 ? "<1%" : `${Math.round(percent)}%`;
}

function formatLastActive(minutes: number) {
	if (minutes < 60) {
		return "Recently";
	}
	if (minutes < 24 * 60) {
		return `${Math.floor(minutes / 60)}h ago`;
	}
	return `${Math.floor(minutes / (24 * 60))}d ago`;
}

function BreakdownRow({
	label,
	row,
	share,
	onClick,
}: {
	label: ReactNode;
	row: UsageShare;
	share: number;
	onClick?: () => void;
}) {
	return (
		<button
			type="button"
			onClick={(event) => {
				event.stopPropagation();
				onClick?.();
			}}
			className="-mx-1.5 block w-[calc(100%+0.75rem)] space-y-1 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-muted/60"
		>
			<div className="flex items-center justify-between gap-3 text-xs">
				<div className="flex min-w-0 items-center gap-1.5">{label}</div>
				<div className="flex shrink-0 items-center gap-2 tabular-nums text-muted-foreground">
					<span>${row.cost.toFixed(2)}</span>
					<span className="w-8 text-right">{formatShare(share)}</span>
				</div>
			</div>
			<div className="h-1 w-full overflow-hidden rounded-full bg-muted">
				<div
					className="h-full rounded-full bg-foreground/60"
					style={{ width: `${Math.max(share * 100, share > 0 ? 2 : 0)}%` }}
				/>
			</div>
		</button>
	);
}

function Stat({ label, value }: { label: string; value: string }) {
	return (
		<div>
			<p className="text-[11px] uppercase tracking-wider text-muted-foreground/60">
				{label}
			</p>
			<p className="text-sm font-medium tabular-nums">{value}</p>
		</div>
	);
}

function ModelLabel({ model }: { model: string }) {
	return (
		<span className="truncate font-mono text-[11px]" title={model}>
			{model}
		</span>
	);
}

function AgentDetail({
	stats,
	onBack,
}: {
	stats: AgentStats;
	onBack: () => void;
}) {
	const { notify, openedAt, project, track } = useDemo();
	const [expanded, setExpanded] = useState<number | null>(0);
	const Icon = stats.icon;
	const logs = DEMO_LOGS.filter((log) => log.source === "coding-agents");
	const sessions = [0, 1, 2, 3].map((index) => {
		const gapMinutes = index * 190;
		const end = subMinutes(openedAt, stats.lastActiveMinutes + gapMinutes);
		const shorterBy = index * 7;
		const minutes = 38 - shorterBy;
		const fewerRequests = index * 3;
		const requests = Math.max(
			4,
			Math.round(stats.requestCount / 900) - fewerRequests,
		);
		return {
			start: subMinutes(end, minutes),
			end,
			minutes,
			requests,
			tokens: Math.round((stats.totalTokens / stats.requestCount) * requests),
			cost: (stats.cost / stats.requestCount) * requests,
		};
	});

	return (
		<div className="space-y-4">
			<button
				type="button"
				className="flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
				onClick={onBack}
			>
				<ArrowLeft className="h-4 w-4" />
				Back to agents
			</button>
			<div className="flex flex-wrap items-center justify-between gap-4 pb-2">
				<div className="flex items-center gap-4">
					<div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-muted">
						<Icon className="h-6 w-6" />
					</div>
					<div>
						<h3 className="text-lg font-semibold tracking-tight">
							{stats.label}
						</h3>
						<div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
							<span>{formatNumber(stats.requestCount)} requests</span>
							<span className="text-border">&middot;</span>
							<span>${stats.cost.toFixed(2)}</span>
							<span className="text-border">&middot;</span>
							<span>{formatTokens(stats.totalTokens)} tokens</span>
						</div>
					</div>
				</div>
				<button
					type="button"
					onClick={() => notify(READ_ONLY_MESSAGE)}
					className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/50"
				>
					<Download className="h-4 w-4" />
					Export CSV
				</button>
			</div>
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
									<span className="shrink-0 tabular-nums text-muted-foreground">
										{formatNumber(model.requestCount)} req
									</span>
								</>
							}
							row={model}
							share={shareOf(model, stats.models)}
							onClick={() => track("agent_model", model.model)}
						/>
					))}
				</div>
			</div>
			<div className="space-y-3">
				{sessions.map((session, index) => (
					<div
						key={session.start.getTime()}
						className="rounded-lg border bg-card"
					>
						<button
							type="button"
							className="w-full p-4 text-left transition-colors hover:bg-muted/50"
							onClick={() => {
								setExpanded(expanded === index ? null : index);
								track("agent_session", String(index));
							}}
						>
							<div className="flex flex-wrap items-center justify-between gap-2">
								<div className="flex items-center gap-2">
									{expanded === index ? (
										<ChevronDown className="h-4 w-4 text-muted-foreground" />
									) : (
										<ChevronRight className="h-4 w-4 text-muted-foreground" />
									)}
									<div className="text-sm text-muted-foreground">
										{session.start.toLocaleDateString()}{" "}
										{session.start.toLocaleTimeString()} &ndash;{" "}
										{session.end.toLocaleTimeString()}
									</div>
								</div>
								<div className="flex items-center gap-4 text-sm text-muted-foreground">
									<span className="flex items-center gap-1" title="Requests">
										<Zap className="h-3.5 w-3.5" />
										{session.requests}
									</span>
									<span
										className="flex items-center gap-1"
										title="Total tokens"
									>
										<Cpu className="h-3.5 w-3.5" />
										{formatNumber(session.tokens)}
									</span>
									<span className="flex items-center gap-1" title="Duration">
										<Clock className="h-3.5 w-3.5" />
										{session.minutes}m
									</span>
									<span className="flex items-center gap-1" title="Cost">
										<Coins className="h-3.5 w-3.5" />${session.cost.toFixed(4)}
									</span>
								</div>
							</div>
						</button>
						{expanded === index && (
							<div className="space-y-2 border-t p-4">
								{logs.map((log) => (
									<DemoLogCard
										key={log.id}
										log={log}
										openedAt={openedAt}
										project={project}
										onToggle={(open) =>
											track("log_expand", open ? log.id : "collapse")
										}
									/>
								))}
							</div>
						)}
					</div>
				))}
			</div>
		</div>
	);
}

export function AgentsView() {
	const { anchorDay, history, openedAt, project, track } = useDemo();
	const [timeRange, setTimeRange] = useState<TimeRangeValue>("7d");
	const [usageMode, setUsageMode] = useState<UsageMode>("total");
	const [viewMode, setViewMode] = useState<ViewMode>("agents");
	const [selected, setSelected] = useState<string | null>(null);

	const activity = activityForRange(timeRange, {
		anchorDay,
		history,
		openedAt,
		project,
	}).map((day) => applyUsageModeToDaily(day, usageMode));
	const agents = buildAgentStats(activity);
	const models = buildModelStats(agents);
	const selectedStats = agents.find((agent) => agent.id === selected);
	// A filter can drop the selected agent; forget it so it can't reopen later.
	if (selected && !selectedStats) {
		setSelected(null);
	}
	const totalRequests = agents.reduce((sum, a) => sum + a.requestCount, 0);
	const totalCost = agents.reduce((sum, a) => sum + a.cost, 0);

	const openAgent = (id: string) => {
		setSelected(id);
		setViewMode("agents");
		track("agent", id);
	};

	return (
		<div className="flex flex-col">
			<div className="flex-1 space-y-4 p-4 pt-6 md:p-8">
				<div>
					<h2 className="text-3xl font-bold tracking-tight">Agents</h2>
					<p className="text-muted-foreground">
						Monitor your AI coding agents and their activity
					</p>
				</div>
				<div className="space-y-4">
					<div className="flex flex-col gap-3">
						<div className="flex flex-wrap items-center gap-3">
							<TimeRangeControl
								value={timeRange}
								onChange={(value) => {
									setTimeRange(value);
									track("time_range", value);
								}}
							/>
							<UsageModeControl
								mode={usageMode}
								onChange={(mode) => {
									setUsageMode(mode);
									track("usage_mode", mode);
								}}
							/>
							<div
								className="inline-flex items-center rounded-lg border border-border/60 bg-muted/40 p-0.5"
								role="group"
								aria-label="Group usage by"
							>
								{(["agents", "models"] as const).map((mode) => (
									<button
										key={mode}
										type="button"
										onClick={() => {
											setViewMode(mode);
											setSelected(null);
											track("agents_view", mode);
										}}
										aria-pressed={viewMode === mode}
										className={cn(
											"rounded-md px-3 py-1 text-xs font-medium capitalize transition-colors",
											viewMode === mode
												? "bg-background text-foreground shadow-sm"
												: "text-muted-foreground hover:text-foreground",
										)}
									>
										{mode}
									</button>
								))}
							</div>
						</div>
						{!selectedStats && (
							<div className="flex items-center gap-3 text-sm text-muted-foreground">
								<span>
									{viewMode === "models"
										? `${models.length} models`
										: `${agents.length} agents`}
								</span>
								<span className="text-border">&middot;</span>
								<span>{formatNumber(totalRequests)} requests</span>
								<span className="text-border">&middot;</span>
								<span className="font-medium text-foreground">
									${totalCost.toFixed(2)}
								</span>
							</div>
						)}
					</div>

					{selectedStats ? (
						<AgentDetail
							stats={selectedStats}
							onBack={() => setSelected(null)}
						/>
					) : viewMode === "models" ? (
						<div className="grid gap-4 @2xl/demo:grid-cols-2 @5xl/demo:grid-cols-3">
							{models.map((stats) => (
								<div
									key={stats.model}
									className="rounded-xl border border-border/60 bg-card p-5"
								>
									<div className="flex items-start justify-between gap-3">
										<div className="min-w-0">
											<h3
												className="truncate font-mono text-sm font-semibold tracking-tight"
												title={stats.model}
											>
												{stats.model}
											</h3>
											<p className="mt-1 text-2xl font-bold tracking-tight tabular-nums">
												${stats.cost.toFixed(2)}
											</p>
										</div>
										<div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
											<Cpu className="h-5 w-5" />
										</div>
									</div>
									<div className="mt-4 grid grid-cols-3 gap-3 border-t border-border/40 pt-3">
										<Stat
											label="Requests"
											value={formatNumber(stats.requestCount)}
										/>
										<Stat
											label="Tokens"
											value={formatTokens(stats.totalTokens)}
										/>
										<Stat
											label="Agents"
											value={formatNumber(stats.agents.length)}
										/>
									</div>
									<div className="mt-3 space-y-1 border-t border-border/40 pt-3">
										{stats.agents.map((usage) => (
											<BreakdownRow
												key={usage.agent.id}
												label={
													<>
														<usage.agent.icon className="h-3.5 w-3.5 shrink-0" />
														<span className="truncate">
															{usage.agent.label}
														</span>
													</>
												}
												row={usage}
												share={shareOf(usage, stats.agents)}
												onClick={() => openAgent(usage.agent.id)}
											/>
										))}
									</div>
								</div>
							))}
						</div>
					) : (
						<div className="grid gap-4 @2xl/demo:grid-cols-2 @5xl/demo:grid-cols-3">
							{agents.map((stats) => (
								<div
									key={stats.id}
									role="button"
									tabIndex={0}
									onClick={() => openAgent(stats.id)}
									onKeyDown={(event) => {
										if (
											event.target === event.currentTarget &&
											(event.key === "Enter" || event.key === " ")
										) {
											event.preventDefault();
											openAgent(stats.id);
										}
									}}
									className="group relative w-full cursor-pointer overflow-hidden rounded-xl border border-border/60 bg-card p-5 text-left transition-all duration-200 hover:border-foreground/15 hover:shadow-lg"
								>
									<div className="flex items-start gap-4">
										<div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-muted transition-colors group-hover:bg-muted/80">
											<stats.icon className="h-6 w-6" />
										</div>
										<div className="min-w-0 flex-1">
											<div className="flex items-center justify-between">
												<h3 className="text-sm font-semibold tracking-tight">
													{stats.label}
												</h3>
												<ChevronRight className="h-4 w-4 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5 group-hover:text-muted-foreground" />
											</div>
											<p className="mt-1 text-2xl font-bold tracking-tight tabular-nums">
												${stats.cost.toFixed(2)}
											</p>
										</div>
									</div>
									<div className="mt-4 grid grid-cols-3 gap-3 border-t border-border/40 pt-3">
										<Stat
											label="Requests"
											value={formatNumber(stats.requestCount)}
										/>
										<Stat
											label="Tokens"
											value={formatTokens(stats.totalTokens)}
										/>
										<Stat
											label="Last active"
											value={formatLastActive(stats.lastActiveMinutes)}
										/>
									</div>
									<div className="mt-3 space-y-1 border-t border-border/40 pt-3">
										<p className="text-[11px] uppercase tracking-wider text-muted-foreground/60">
											Models
										</p>
										{stats.models.slice(0, 3).map((model) => (
											<BreakdownRow
												key={model.model}
												label={<ModelLabel model={model.model} />}
												row={model}
												share={shareOf(model, stats.models)}
												onClick={() => openAgent(stats.id)}
											/>
										))}
									</div>
								</div>
							))}
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
