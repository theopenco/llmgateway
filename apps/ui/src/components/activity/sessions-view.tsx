"use client";

import {
	ChevronDown,
	ChevronRight,
	Clock,
	Coins,
	Cpu,
	Terminal,
	Zap,
} from "lucide-react";
import { useState } from "react";

import { LogCard } from "@/components/dashboard/log-card";
import { Button } from "@/lib/components/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/lib/components/select";
import { useApi } from "@/lib/fetch-client";

import type { paths } from "@/lib/api/v1";
import type { Log } from "@llmgateway/db";

type ApiLog =
	paths["/logs"]["get"]["responses"][200]["content"]["application/json"]["logs"][number];

interface Session {
	id: string;
	source: string;
	startTime: Date;
	endTime: Date;
	logs: ApiLog[];
	totalCost: number;
	totalTokens: number;
	totalPromptTokens: number;
	totalCompletionTokens: number;
	duration: number;
}

const SESSION_GAP_MS = 30 * 60 * 1000; // 30 minutes

// Known coding tool sources that generate sessions
const KNOWN_SOURCES = [
	"claude.com/claude-code",
	"open-code",
	"opencode",
	"cursor",
] as const;

const SOURCE_OPTIONS = [
	{ value: "all", label: "All integrations" },
	{ value: "claude.com/claude-code", label: "Claude Code" },
	{ value: "open-code", label: "Open Code" },
	{ value: "opencode", label: "OpenCode" },
	{ value: "cursor", label: "Cursor" },
] as const;

function toUiLog(log: ApiLog): Partial<Log> {
	return {
		...log,
		createdAt: new Date(log.createdAt),
		updatedAt: new Date(log.updatedAt),
		toolChoice: log.toolChoice as any,
		customHeaders: log.customHeaders as any,
	};
}

function buildSession(logs: ApiLog[], index: number): Session {
	const startTime = new Date(logs[0].createdAt);
	const endTime = new Date(logs[logs.length - 1].createdAt);

	return {
		id: `session-${index}`,
		source: logs[0].source ?? "unknown",
		startTime,
		endTime,
		logs: [...logs].reverse(),
		totalCost: logs.reduce((sum, log) => sum + (log.cost ?? 0), 0),
		totalTokens: logs.reduce(
			(sum, log) => sum + Number(log.totalTokens ?? 0),
			0,
		),
		totalPromptTokens: logs.reduce(
			(sum, log) => sum + Number(log.promptTokens ?? 0),
			0,
		),
		totalCompletionTokens: logs.reduce(
			(sum, log) => sum + Number(log.completionTokens ?? 0),
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
	let currentSession: ApiLog[] = [sorted[0]];

	for (let i = 1; i < sorted.length; i++) {
		const prevTime = new Date(sorted[i - 1].createdAt).getTime();
		const currTime = new Date(sorted[i].createdAt).getTime();
		const sourceChanged =
			(sorted[i].source ?? "") !== (sorted[i - 1].source ?? "");

		if (currTime - prevTime > SESSION_GAP_MS || sourceChanged) {
			sessions.push(buildSession(currentSession, sessions.length));
			currentSession = [sorted[i]];
		} else {
			currentSession.push(sorted[i]);
		}
	}

	if (currentSession.length > 0) {
		sessions.push(buildSession(currentSession, sessions.length));
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

function formatSourceLabel(source: string): string {
	switch (source) {
		case "claude.com/claude-code":
			return "Claude Code";
		case "open-code":
			return "Open Code";
		case "opencode":
			return "OpenCode";
		case "cursor":
			return "Cursor";
		case "chatbox":
			return "Chatbox";
		case "llmgateway.io/playground":
			return "Playground";
		default:
			return source;
	}
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
						<div>
							<div className="font-medium">
								{formatSourceLabel(session.source)}
							</div>
							<div className="text-sm text-muted-foreground">
								{session.startTime.toLocaleDateString()}{" "}
								{session.startTime.toLocaleTimeString()} -{" "}
								{session.endTime.toLocaleTimeString()}
							</div>
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

export function SessionsView({
	projectId,
	orgId,
}: {
	projectId: string;
	orgId: string;
}) {
	const [source, setSource] = useState<string>("all");
	const api = useApi();

	const queryParams: Record<string, string> = {
		orderBy: "createdAt_desc",
		projectId,
		limit: "100",
	};

	if (source !== "all") {
		queryParams.source = source;
	}

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
			initialPageParam: undefined,
			getNextPageParam: (lastPage) => {
				return lastPage?.pagination?.hasMore
					? lastPage.pagination.nextCursor
					: undefined;
			},
		},
	);

	const allLogs = data?.pages.flatMap((page) => page?.logs ?? []) ?? [];

	// Only include logs from known integration sources
	const integrationLogs = allLogs.filter(
		(log) =>
			log.source && (KNOWN_SOURCES as readonly string[]).includes(log.source),
	);
	const sessions = groupLogsIntoSessions(integrationLogs);

	return (
		<div className="space-y-4">
			<div className="flex flex-wrap gap-2 mb-4 sticky top-0 bg-background z-10 py-2">
				<Select value={source} onValueChange={setSource}>
					<SelectTrigger className="w-[200px]">
						<SelectValue placeholder="Filter by source" />
					</SelectTrigger>
					<SelectContent>
						{SOURCE_OPTIONS.map((opt) => (
							<SelectItem key={opt.value} value={opt.value}>
								{opt.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>

			{isLoading ? (
				<div className="flex flex-col items-center justify-center py-16">
					<div className="h-8 w-8 animate-spin rounded-full border-2 border-muted-foreground/20 border-t-muted-foreground/70" />
					<p className="mt-4 text-sm text-muted-foreground">
						Loading sessions...
					</p>
				</div>
			) : error ? (
				<div className="py-8 text-center text-sm text-destructive">
					Failed to load sessions. Please try again.
				</div>
			) : (
				<div className="space-y-3">
					{sessions.length === 0 && !hasNextPage ? (
						<div className="flex flex-col items-center justify-center py-16 px-4">
							<div className="relative mb-6">
								<div className="absolute -inset-3 rounded-full bg-muted/50 blur-md" />
								<div className="relative rounded-xl border border-border/60 bg-muted/30 p-4">
									<Terminal className="h-8 w-8 text-muted-foreground/70" />
								</div>
							</div>
							<h3 className="text-lg font-semibold tracking-tight mb-1.5">
								No sessions yet
							</h3>
							<p className="text-sm text-muted-foreground max-w-sm text-center mb-6">
								Sessions appear when coding tools like Claude Code, OpenCode, or
								Cursor make API requests through the gateway.
							</p>
							<div className="flex items-center gap-6 text-xs text-muted-foreground/60">
								<div className="flex items-center gap-1.5">
									<div className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
									Claude Code
								</div>
								<div className="flex items-center gap-1.5">
									<div className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
									OpenCode
								</div>
								<div className="flex items-center gap-1.5">
									<div className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
									Cursor
								</div>
							</div>
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
				</div>
			)}
		</div>
	);
}
