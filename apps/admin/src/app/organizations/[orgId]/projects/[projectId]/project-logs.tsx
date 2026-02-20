"use client";

import { formatDistanceToNow } from "date-fns";
import {
	AlertCircle,
	CheckCircle2,
	Clock,
	Coins,
	Loader2,
	Package,
	TrendingDown,
	Zap,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	loadProjectLogsAction,
	type ProjectLogEntry,
	type ProjectLogsResponse,
} from "@/lib/admin-organizations";

function formatDuration(ms: number) {
	if (ms < 1000) {
		return `${ms}ms`;
	}
	return `${(ms / 1000).toFixed(2)}s`;
}

function LogRow({ log }: { log: ProjectLogEntry }) {
	let StatusIcon = CheckCircle2;
	let color = "text-green-500";
	let bgColor = "bg-green-100";

	if (log.hasError || log.unifiedFinishReason === "error") {
		StatusIcon = AlertCircle;
		color = "text-red-500";
		bgColor = "bg-red-100";
	} else if (
		log.unifiedFinishReason !== "completed" &&
		log.unifiedFinishReason !== "tool_calls"
	) {
		StatusIcon = AlertCircle;
		color = "text-yellow-500";
		bgColor = "bg-yellow-100";
	}

	return (
		<div className="flex items-start gap-3 rounded-lg border border-border/60 bg-card p-3">
			<div className={`mt-0.5 rounded-full p-1 ${bgColor}`}>
				<StatusIcon className={`h-4 w-4 ${color}`} />
			</div>
			<div className="flex-1 min-w-0 space-y-1">
				<div className="flex items-start justify-between gap-2">
					<p className="text-sm font-medium truncate">{log.content ?? "---"}</p>
					<Badge
						variant={log.hasError ? "destructive" : "default"}
						className="flex-shrink-0 text-xs"
					>
						{log.unifiedFinishReason ?? "—"}
					</Badge>
				</div>
				<div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
					<div className="flex items-center gap-1">
						<Package className="h-3 w-3" />
						<span>{log.usedModel}</span>
					</div>
					<div className="flex items-center gap-1">
						<Zap className="h-3 w-3" />
						<span>
							{log.cached
								? "Cached"
								: log.cachedTokens && Number(log.cachedTokens) > 0
									? "Partial cache"
									: "Not cached"}
						</span>
					</div>
					<div className="flex items-center gap-1">
						<Clock className="h-3 w-3" />
						<span>{log.totalTokens ?? 0} tokens</span>
					</div>
					<div className="flex items-center gap-1">
						<Clock className="h-3 w-3" />
						<span>{formatDuration(log.duration)}</span>
					</div>
					<div className="flex items-center gap-1">
						<Coins className="h-3 w-3" />
						<span>{log.cost ? `$${log.cost.toFixed(6)}` : "$0"}</span>
					</div>
					{log.discount && log.discount !== 1 && (
						<div className="flex items-center gap-1 text-emerald-600">
							<TrendingDown className="h-3 w-3" />
							<span>{(log.discount * 100).toFixed(0)}% off</span>
						</div>
					)}
					{log.source && (
						<span className="text-muted-foreground">{log.source}</span>
					)}
					<span className="ml-auto">
						{formatDistanceToNow(new Date(log.createdAt), {
							addSuffix: true,
						})}
					</span>
				</div>
			</div>
		</div>
	);
}

export function ProjectLogsSection({
	orgId,
	projectId,
}: {
	orgId: string;
	projectId: string;
}) {
	const [logs, setLogs] = useState<ProjectLogEntry[]>([]);
	const [loading, setLoading] = useState(true);
	const [loadingMore, setLoadingMore] = useState(false);
	const [pagination, setPagination] = useState<
		ProjectLogsResponse["pagination"] | null
	>(null);

	const loadLogs = useCallback(
		async (cursor?: string) => {
			if (cursor) {
				setLoadingMore(true);
			} else {
				setLoading(true);
			}

			try {
				const data = await loadProjectLogsAction(orgId, projectId, cursor);

				if (data) {
					if (cursor) {
						setLogs((prev) => [...prev, ...data.logs]);
					} else {
						setLogs(data.logs);
					}
					setPagination(data.pagination);
				}
			} catch (error) {
				console.error("Failed to load project logs:", error);
			} finally {
				setLoading(false);
				setLoadingMore(false);
			}
		},
		[orgId, projectId],
	);

	useEffect(() => {
		void loadLogs();
	}, [loadLogs]);

	if (loading) {
		return (
			<section className="space-y-4">
				<h2 className="text-lg font-semibold">Recent Logs</h2>
				<div className="flex items-center justify-center gap-2 rounded-lg border border-border/60 p-8 text-sm text-muted-foreground">
					<Loader2 className="h-4 w-4 animate-spin" />
					Loading logs...
				</div>
			</section>
		);
	}

	return (
		<section className="space-y-4">
			<h2 className="text-lg font-semibold">Recent Logs</h2>
			{logs.length === 0 ? (
				<div className="rounded-lg border border-dashed border-border/60 p-8 text-center text-sm text-muted-foreground">
					No logs found for this project.
				</div>
			) : (
				<div className="space-y-2">
					{logs.map((log) => (
						<LogRow key={log.id} log={log} />
					))}
					{pagination?.hasMore && (
						<div className="flex justify-center pt-2">
							<Button
								variant="outline"
								size="sm"
								disabled={loadingMore}
								onClick={() => {
									if (pagination.nextCursor) {
										void loadLogs(pagination.nextCursor);
									}
								}}
							>
								{loadingMore ? (
									<>
										<Loader2 className="mr-2 h-4 w-4 animate-spin" />
										Loading...
									</>
								) : (
									"Load More"
								)}
							</Button>
						</div>
					)}
				</div>
			)}
		</section>
	);
}
