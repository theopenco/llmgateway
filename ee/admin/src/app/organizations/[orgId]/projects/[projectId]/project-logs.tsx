"use client";

import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { LogCard } from "@/components/log-card";
import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { loadProjectLogsAction } from "@/lib/admin-organizations";

import type { ProjectLogEntry, ProjectLogsResponse } from "@/lib/types";

const UnifiedFinishReason = {
	COMPLETED: "completed",
	LENGTH_LIMIT: "length_limit",
	CONTENT_FILTER: "content_filter",
	TOOL_CALLS: "tool_calls",
	GATEWAY_ERROR: "gateway_error",
	UPSTREAM_ERROR: "upstream_error",
	CANCELED: "canceled",
	UNKNOWN: "unknown",
} as const;

const SOURCE_OPTIONS = [
	{ value: "all", label: "All sources" },
	{ value: "claude.com/claude-code", label: "Claude Code" },
	{ value: "open-code", label: "Open Code" },
	{ value: "cursor", label: "Cursor" },
	{ value: "chatbox", label: "Chatbox" },
	{ value: "llmgateway.io/playground", label: "Playground" },
] as const;

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

	// Stable set of unique values from initial unfiltered load
	const [knownProviders, setKnownProviders] = useState<string[]>([]);
	const [knownModels, setKnownModels] = useState<string[]>([]);

	// Filter state
	const [provider, setProvider] = useState<string>("all");
	const [model, setModel] = useState<string>("all");
	const [source, setSource] = useState<string>("all");
	const [unifiedFinishReason, setUnifiedFinishReason] = useState<string>("all");

	const getFilters = useCallback(() => {
		const filters: Record<string, string> = {};
		if (provider !== "all") {
			filters.provider = provider;
		}
		if (model !== "all") {
			filters.model = model;
		}
		if (source !== "all") {
			filters.source = source;
		}
		if (unifiedFinishReason !== "all") {
			filters.unifiedFinishReason = unifiedFinishReason;
		}
		return Object.keys(filters).length > 0 ? filters : undefined;
	}, [provider, model, source, unifiedFinishReason]);

	// Extract unique providers/models from a batch of logs
	const extractUniqueValues = useCallback((entries: ProjectLogEntry[]) => {
		const providers = new Set<string>();
		const models = new Set<string>();
		for (const log of entries) {
			if (log.usedProvider) {
				providers.add(log.usedProvider);
			}
			if (log.usedModel) {
				const slashIndex = log.usedModel.indexOf("/");
				models.add(
					slashIndex !== -1
						? log.usedModel.substring(slashIndex + 1)
						: log.usedModel,
				);
			}
		}
		return {
			providers: Array.from(providers).sort(),
			models: Array.from(models).sort(),
		};
	}, []);

	const loadLogs = useCallback(
		async (cursor?: string) => {
			if (cursor) {
				setLoadingMore(true);
			} else {
				setLoading(true);
			}

			try {
				const data = await loadProjectLogsAction(
					orgId,
					projectId,
					cursor,
					getFilters(),
				);

				if (data) {
					if (cursor) {
						setLogs((prev) => [...prev, ...data.logs]);
					} else {
						setLogs(data.logs);
					}
					setPagination(data.pagination);

					// Accumulate dropdown options from all loaded pages
					if (data.logs.length > 0) {
						const { providers, models } = extractUniqueValues(data.logs);
						setKnownProviders((prev) => {
							const merged = new Set([...prev, ...providers]);
							return Array.from(merged).sort();
						});
						setKnownModels((prev) => {
							const merged = new Set([...prev, ...models]);
							return Array.from(merged).sort();
						});
					}
				}
			} catch (error) {
				console.error("Failed to load project logs:", error);
			} finally {
				setLoading(false);
				setLoadingMore(false);
			}
		},
		[orgId, projectId, getFilters, extractUniqueValues],
	);

	useEffect(() => {
		void loadLogs();
	}, [loadLogs]);

	return (
		<section className="space-y-4">
			<h2 className="text-lg font-semibold">Recent Logs</h2>

			<div className="flex flex-wrap gap-2">
				<Select value={provider} onValueChange={setProvider}>
					<SelectTrigger className="w-[160px]">
						<SelectValue placeholder="Filter by provider" />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="all">All providers</SelectItem>
						{knownProviders.map((p) => (
							<SelectItem key={p} value={p}>
								{p}
							</SelectItem>
						))}
					</SelectContent>
				</Select>

				<Select value={model} onValueChange={setModel}>
					<SelectTrigger className="w-[200px]">
						<SelectValue placeholder="Filter by model" />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="all">All models</SelectItem>
						{knownModels.map((m) => (
							<SelectItem key={m} value={m}>
								{m}
							</SelectItem>
						))}
					</SelectContent>
				</Select>

				<Select value={source} onValueChange={setSource}>
					<SelectTrigger className="w-[180px]">
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

				<Select
					value={unifiedFinishReason}
					onValueChange={setUnifiedFinishReason}
				>
					<SelectTrigger className="w-[200px]">
						<SelectValue placeholder="Filter by status" />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="all">All statuses</SelectItem>
						{Object.entries(UnifiedFinishReason).map(([key, value]) => (
							<SelectItem key={value} value={value}>
								{key
									.toLowerCase()
									.replace(/_/g, " ")
									.replace(/\b\w/g, (l) => l.toUpperCase())}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>

			{loading ? (
				<div className="flex items-center justify-center gap-2 rounded-lg border border-border/60 p-8 text-sm text-muted-foreground">
					<Loader2 className="h-4 w-4 animate-spin" />
					Loading logs...
				</div>
			) : logs.length === 0 ? (
				<div className="rounded-lg border border-dashed border-border/60 p-8 text-center text-sm text-muted-foreground">
					No logs found for this project.
				</div>
			) : (
				<div className="space-y-2">
					{logs.map((log) => (
						<LogCard key={log.id} log={log} />
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
