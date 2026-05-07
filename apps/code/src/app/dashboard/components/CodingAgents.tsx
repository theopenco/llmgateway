"use client";

import { ArrowLeft, ChevronRight, Coins, Cpu, Terminal } from "lucide-react";
import { useMemo, useState } from "react";

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
import type { ComponentType, SVGProps } from "react";

type ApiLog =
	paths["/logs"]["get"]["responses"][200]["content"]["application/json"]["logs"][number];

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

interface AgentDefinition {
	id: string;
	label: string;
	icon: IconComponent;
	sources: string[];
	guideUrl: string;
}

const AGENTS: AgentDefinition[] = [
	{
		id: "claude-code",
		label: "Claude Code",
		icon: AnthropicIcon,
		sources: ["claude.com/claude-code"],
		guideUrl: "/guides/claude-code",
	},
	{
		id: "opencode",
		label: "OpenCode",
		icon: OpenCodeIcon,
		sources: ["opencode", "open-code"],
		guideUrl: "/guides/opencode",
	},
	{
		id: "cursor",
		label: "Cursor",
		icon: CursorIcon,
		sources: ["cursor"],
		guideUrl: "/guides/cursor",
	},
	{
		id: "autohand",
		label: "Autohand Code",
		icon: AutohandIcon,
		sources: ["autohand"],
		guideUrl: "/guides/autohand",
	},
	{
		id: "soulforge",
		label: "SoulForge",
		icon: SoulForgeIcon,
		sources: ["soulforge"],
		guideUrl: "/guides/soulforge",
	},
	{
		id: "cline",
		label: "Cline",
		icon: ClineIcon,
		sources: ["cline"],
		guideUrl: "/guides/cline",
	},
	{
		id: "codex",
		label: "Codex CLI",
		icon: CodexIcon,
		sources: ["codex"],
		guideUrl: "/guides/codex",
	},
	{
		id: "n8n",
		label: "n8n",
		icon: N8nIcon,
		sources: ["n8n"],
		guideUrl: "/guides/n8n",
	},
	{
		id: "openclaw",
		label: "OpenClaw",
		icon: OpenClawIcon,
		sources: ["openclaw"],
		guideUrl: "/guides/openclaw",
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
		const sources = agent.sources.map((s) => s.toLowerCase());
		const agentLogs = logs.filter((log) => {
			const src = String(log.source ?? "").toLowerCase();
			return src.length > 0 && sources.includes(src);
		});
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

function AgentDetail({
	stats,
	onBack,
}: {
	stats: AgentStats;
	onBack: () => void;
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
			<button
				type="button"
				onClick={onBack}
				className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
			>
				<ArrowLeft className="h-4 w-4" />
				All coding agents
			</button>
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

export default function CodingAgents({ orgId }: { orgId: string }) {
	const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
	const api = useApi();

	const since = useMemo(() => {
		const d = new Date();
		d.setDate(d.getDate() - 30);
		return d.toISOString();
	}, []);
	const until = useMemo(() => new Date().toISOString(), []);

	const { data, isLoading, error } = api.useQuery(
		"get",
		"/logs",
		{
			params: {
				query: {
					orgId,
					orderBy: "createdAt_desc",
					limit: "100",
					source: ALL_SOURCES.join(","),
					startDate: since,
					endDate: until,
				},
			},
		},
		{
			enabled: !!orgId,
			refetchOnWindowFocus: false,
			staleTime: 60_000,
		},
	);

	const allLogs = useMemo(() => data?.logs ?? [], [data]);
	const agentStats = useMemo(() => computeAgentStats(allLogs), [allLogs]);
	const selectedStats = selectedAgentId
		? agentStats.find((s) => s.agent.id === selectedAgentId)
		: null;

	const totalCost = agentStats.reduce((sum, s) => sum + s.totalCost, 0);
	const totalRequests = agentStats.reduce((sum, s) => sum + s.requestCount, 0);

	return (
		<div>
			<div className="mb-4 flex items-end justify-between gap-4">
				<div>
					<h2 className="font-semibold">Coding Agents</h2>
					<p className="mt-0.5 text-sm text-muted-foreground">
						Per-tool usage, costs, and recent activity from the last 30 days.
					</p>
				</div>
				{!selectedStats && agentStats.length > 0 && (
					<div className="hidden items-center gap-2 text-xs text-muted-foreground sm:flex">
						<span>{agentStats.length} active</span>
						<span className="text-border">·</span>
						<span>{totalRequests.toLocaleString()} requests</span>
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
			) : selectedStats ? (
				<AgentDetail
					stats={selectedStats}
					onBack={() => setSelectedAgentId(null)}
				/>
			) : agentStats.length === 0 ? (
				<AgentsEmpty hadError={!!error} />
			) : (
				<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
					{agentStats.map((stats) => (
						<AgentCard
							key={stats.agent.id}
							stats={stats}
							onClick={() => setSelectedAgentId(stats.agent.id)}
						/>
					))}
				</div>
			)}
		</div>
	);
}
