"use client";

import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
import {
	useCallback,
	useDeferredValue,
	useEffect,
	useMemo,
	useState,
} from "react";

import { LogCard } from "@/components/log-card";
import { Button } from "@/components/ui/button";
import {
	Command,
	CommandEmpty,
	CommandInput,
	CommandItem,
	CommandList,
} from "@/components/ui/command";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { loadProjectLogsAction } from "@/lib/admin-organizations";
import { cn } from "@/lib/utils";

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

interface ProviderOption {
	id: string;
	label: string;
}

interface ModelOption {
	id: string;
	label: string;
	aliases: string[];
	providerIds: string[];
}

export function ProjectLogsSection({
	orgId,
	projectId,
	providerOptions,
	modelOptions,
}: {
	orgId: string;
	projectId: string;
	providerOptions: ProviderOption[];
	modelOptions: ModelOption[];
}) {
	const [logs, setLogs] = useState<ProjectLogEntry[]>([]);
	const [loading, setLoading] = useState(true);
	const [loadingMore, setLoadingMore] = useState(false);
	const [pagination, setPagination] = useState<
		ProjectLogsResponse["pagination"] | null
	>(null);

	// Filter state
	const [provider, setProvider] = useState<string>("all");
	const [model, setModel] = useState<string>("all");
	const [source, setSource] = useState<string>("all");
	const [unifiedFinishReason, setUnifiedFinishReason] = useState<string>("all");

	// Model picker state
	const [modelPickerOpen, setModelPickerOpen] = useState(false);
	const [modelSearch, setModelSearch] = useState("");
	const deferredModelSearch = useDeferredValue(modelSearch);

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
				}
			} catch (error) {
				console.error("Failed to load project logs:", error);
			} finally {
				setLoading(false);
				setLoadingMore(false);
			}
		},
		[orgId, projectId, getFilters],
	);

	useEffect(() => {
		void loadLogs();
	}, [loadLogs]);

	const selectedModelOption = useMemo(
		() => modelOptions.find((option) => option.id === model),
		[model, modelOptions],
	);

	const filteredModelOptions = useMemo(() => {
		const normalizedSearch = deferredModelSearch
			.trim()
			.toLowerCase()
			.replace(/[\s/_-]/g, "");

		return modelOptions.filter((option) => {
			if (provider !== "all" && !option.providerIds.includes(provider)) {
				return false;
			}

			if (!normalizedSearch) {
				return true;
			}

			const searchFields = [option.id, option.label, ...option.aliases];
			return searchFields.some((field) =>
				field
					.toLowerCase()
					.replace(/[\s/_-]/g, "")
					.includes(normalizedSearch),
			);
		});
	}, [deferredModelSearch, modelOptions, provider]);

	const handleProviderChange = useCallback(
		(value: string) => {
			setProvider(value);
			// Clear model if it's not available for the new provider
			if (
				value !== "all" &&
				model !== "all" &&
				!modelOptions.some(
					(option) => option.id === model && option.providerIds.includes(value),
				)
			) {
				setModel("all");
			}
		},
		[model, modelOptions],
	);

	return (
		<section className="space-y-4">
			<h2 className="text-lg font-semibold">Recent Logs</h2>

			<div className="flex flex-wrap gap-2">
				<Select value={provider} onValueChange={handleProviderChange}>
					<SelectTrigger className="w-[160px]">
						<SelectValue placeholder="Filter by provider" />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="all">All providers</SelectItem>
						{providerOptions.map((p) => (
							<SelectItem key={p.id} value={p.id}>
								{p.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>

				<Popover open={modelPickerOpen} onOpenChange={setModelPickerOpen}>
					<PopoverTrigger asChild>
						<Button
							variant="outline"
							role="combobox"
							aria-expanded={modelPickerOpen}
							className="w-[260px] justify-between"
						>
							<span className="truncate">
								{selectedModelOption?.label ??
									(model !== "all" ? model : "Filter by model")}
							</span>
							<ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
						</Button>
					</PopoverTrigger>
					<PopoverContent className="w-[320px] p-0" align="start">
						<Command shouldFilter={false}>
							<CommandInput
								placeholder="Search models..."
								value={modelSearch}
								onValueChange={setModelSearch}
							/>
							<CommandList>
								<CommandEmpty>No models found.</CommandEmpty>
								<CommandItem
									value="all"
									onSelect={() => {
										setModel("all");
										setModelPickerOpen(false);
										setModelSearch("");
									}}
								>
									<Check
										className={cn(
											"h-4 w-4",
											model === "all" ? "opacity-100" : "opacity-0",
										)}
									/>
									All models
								</CommandItem>
								{filteredModelOptions.map((option) => (
									<CommandItem
										key={option.id}
										value={`${option.id} ${option.label} ${option.aliases.join(" ")}`}
										onSelect={() => {
											setModel(option.id);
											setModelPickerOpen(false);
											setModelSearch("");
										}}
									>
										<Check
											className={cn(
												"h-4 w-4",
												model === option.id ? "opacity-100" : "opacity-0",
											)}
										/>
										<div className="flex min-w-0 flex-col">
											<span className="truncate">{option.label}</span>
											{option.label !== option.id ? (
												<span className="truncate text-xs text-muted-foreground">
													{option.id}
												</span>
											) : null}
										</div>
									</CommandItem>
								))}
							</CommandList>
						</Command>
					</PopoverContent>
				</Popover>

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
