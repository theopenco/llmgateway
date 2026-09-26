"use client";

import { Check, ChevronsUpDown, Loader2, RefreshCw } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
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
import {
	loadOrganizationLogsAction,
	loadProjectLogsAction,
} from "@/lib/admin-organizations";
import { cn } from "@/lib/utils";

import {
	isLogErrorType,
	LOG_ERROR_TYPE_LABELS,
	LOG_ERROR_TYPES,
} from "@llmgateway/shared";

import type {
	ProjectLogEntry,
	ProjectLogFilters,
	ProjectLogsResponse,
} from "@/lib/types";
import type { LogErrorType } from "@llmgateway/shared";

const UnifiedFinishReason = {
	COMPLETED: "completed",
	LENGTH_LIMIT: "length_limit",
	CONTENT_FILTER: "content_filter",
	TOOL_CALLS: "tool_calls",
	CLIENT_ERROR: "client_error",
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
	{ value: "llmgateway.io/playground", label: "Lounge" },
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

export interface SeatOption {
	email: string;
	name: string | null;
}

export interface LogsProjectOption {
	id: string;
	name: string;
}

export function LogsSection({
	orgId,
	projectId,
	providerOptions,
	modelOptions,
	seatOptions,
	projectOptions,
	title = "Recent Logs",
}: {
	orgId: string;
	/** Omit to read every project in the organization. */
	projectId?: string;
	providerOptions: ProviderOption[];
	modelOptions: ModelOption[];
	seatOptions: SeatOption[];
	/** Only rendered in the organization-wide view. */
	projectOptions?: LogsProjectOption[];
	title?: string;
}) {
	const searchParams = useSearchParams();
	const router = useRouter();
	const pathname = usePathname();

	const [logs, setLogs] = useState<ProjectLogEntry[]>([]);
	const [loading, setLoading] = useState(true);
	const [loadingMore, setLoadingMore] = useState(false);
	const [refreshing, setRefreshing] = useState(false);
	const [pagination, setPagination] = useState<
		ProjectLogsResponse["pagination"] | null
	>(null);

	const provider = searchParams.get("provider") ?? "all";
	const model = searchParams.get("model") ?? "all";
	const source = searchParams.get("source") ?? "all";
	const unifiedFinishReason = searchParams.get("unifiedFinishReason") ?? "all";
	const userEmail = searchParams.get("userEmail") ?? "all";
	const logProject = searchParams.get("logProject") ?? "all";
	const errorTypeParam = searchParams.get("errorType") ?? "all";
	const errorType: LogErrorType = isLogErrorType(errorTypeParam)
		? errorTypeParam
		: "all";

	const updateFilters = useCallback(
		(updates: Record<string, string>) => {
			const params = new URLSearchParams(searchParams.toString());
			for (const [key, value] of Object.entries(updates)) {
				if (value === "all") {
					params.delete(key);
				} else {
					params.set(key, value);
				}
			}
			const query = params.toString();
			router.replace(query ? `${pathname}?${query}` : pathname, {
				scroll: false,
			});
		},
		[searchParams, router, pathname],
	);

	// Model picker state
	const [modelPickerOpen, setModelPickerOpen] = useState(false);
	const [modelSearch, setModelSearch] = useState("");
	const deferredModelSearch = useDeferredValue(modelSearch);

	// Seat (user email) picker state
	const [seatPickerOpen, setSeatPickerOpen] = useState(false);
	const [seatSearch, setSeatSearch] = useState("");
	const deferredSeatSearch = useDeferredValue(seatSearch);

	const getFilters = useCallback(() => {
		const filters: ProjectLogFilters = {};
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
		if (errorType !== "all") {
			filters.errorType = errorType;
		}
		if (userEmail !== "all") {
			filters.userEmail = userEmail;
		}
		if (!projectId && logProject !== "all") {
			filters.projectId = logProject;
		}
		return Object.keys(filters).length > 0 ? filters : undefined;
	}, [
		provider,
		model,
		source,
		unifiedFinishReason,
		errorType,
		userEmail,
		logProject,
		projectId,
	]);

	const loadLogs = useCallback(
		async (cursor?: string, options?: { background?: boolean }) => {
			if (cursor) {
				setLoadingMore(true);
			} else if (options?.background) {
				setRefreshing(true);
			} else {
				setLoading(true);
			}

			try {
				const data = projectId
					? await loadProjectLogsAction(orgId, projectId, cursor, getFilters())
					: await loadOrganizationLogsAction(orgId, cursor, getFilters());

				if (data) {
					if (cursor) {
						setLogs((prev) => [...prev, ...data.logs]);
					} else {
						setLogs(data.logs);
					}
					setPagination(data.pagination);
				}
			} catch (error) {
				console.error("Failed to load logs:", error);
			} finally {
				setLoading(false);
				setLoadingMore(false);
				setRefreshing(false);
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

	const seatSearchTerm = deferredSeatSearch.trim();

	const filteredSeatOptions = useMemo(() => {
		const normalizedSearch = seatSearchTerm.toLowerCase();
		if (!normalizedSearch) {
			return seatOptions;
		}
		return seatOptions.filter((option) =>
			[option.email, option.name ?? ""].some((field) =>
				field.toLowerCase().includes(normalizedSearch),
			),
		);
	}, [seatOptions, seatSearchTerm]);

	// Former members and users from other organizations never show up in the
	// member list, so an arbitrary email stays selectable.
	const showSeatFreeText =
		seatSearchTerm.length > 0 &&
		!seatOptions.some(
			(option) => option.email.toLowerCase() === seatSearchTerm.toLowerCase(),
		);

	const applySeat = useCallback(
		(value: string) => {
			updateFilters({ userEmail: value });
			setSeatPickerOpen(false);
			setSeatSearch("");
		},
		[updateFilters],
	);

	const handleProviderChange = useCallback(
		(value: string) => {
			const updates: Record<string, string> = { provider: value };
			// Clear model if it's not available for the new provider
			if (
				value !== "all" &&
				model !== "all" &&
				!modelOptions.some(
					(option) => option.id === model && option.providerIds.includes(value),
				)
			) {
				updates.model = "all";
			}
			updateFilters(updates);
		},
		[model, modelOptions, updateFilters],
	);

	return (
		<section className="space-y-4">
			<h2 className="text-lg font-semibold">{title}</h2>

			<div className="flex flex-wrap gap-2">
				{!projectId && projectOptions && projectOptions.length > 0 && (
					<Select
						value={logProject}
						onValueChange={(value) => updateFilters({ logProject: value })}
					>
						<SelectTrigger className="w-[200px]">
							<SelectValue placeholder="Filter by project" />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="all">All projects</SelectItem>
							{projectOptions.map((p) => (
								<SelectItem key={p.id} value={p.id}>
									{p.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				)}

				<Popover open={seatPickerOpen} onOpenChange={setSeatPickerOpen}>
					<PopoverTrigger asChild>
						<Button
							variant="outline"
							role="combobox"
							aria-expanded={seatPickerOpen}
							className="w-[240px] justify-between"
							title="Filter by the user whose API key served the request"
						>
							<span className="truncate">
								{userEmail !== "all" ? userEmail : "Filter by user"}
							</span>
							<ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
						</Button>
					</PopoverTrigger>
					<PopoverContent className="w-[300px] p-0" align="start">
						<Command shouldFilter={false}>
							<CommandInput
								placeholder="Search or type an email..."
								value={seatSearch}
								onValueChange={setSeatSearch}
							/>
							<CommandList>
								{filteredSeatOptions.length === 0 && !showSeatFreeText && (
									<CommandEmpty>No members found.</CommandEmpty>
								)}
								<CommandItem value="all" onSelect={() => applySeat("all")}>
									<Check
										className={cn(
											"h-4 w-4",
											userEmail === "all" ? "opacity-100" : "opacity-0",
										)}
									/>
									All users
								</CommandItem>
								{showSeatFreeText && (
									<CommandItem
										value={`free-text-${seatSearchTerm}`}
										onSelect={() => applySeat(seatSearchTerm)}
									>
										<Check className="h-4 w-4 opacity-0" />
										<span className="truncate">
											Use &ldquo;{seatSearchTerm}&rdquo;
										</span>
									</CommandItem>
								)}
								{filteredSeatOptions.map((option) => (
									<CommandItem
										key={option.email}
										value={option.email}
										onSelect={() => applySeat(option.email)}
									>
										<Check
											className={cn(
												"h-4 w-4",
												userEmail === option.email
													? "opacity-100"
													: "opacity-0",
											)}
										/>
										<div className="flex min-w-0 flex-col">
											<span className="truncate">{option.email}</span>
											{option.name ? (
												<span className="truncate text-xs text-muted-foreground">
													{option.name}
												</span>
											) : null}
										</div>
									</CommandItem>
								))}
							</CommandList>
						</Command>
					</PopoverContent>
				</Popover>

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
										updateFilters({ model: "all" });
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
											updateFilters({ model: option.id });
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

				<Select
					value={source}
					onValueChange={(value) => updateFilters({ source: value })}
				>
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
					onValueChange={(value) =>
						updateFilters({ unifiedFinishReason: value })
					}
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

				<Select
					value={errorType}
					onValueChange={(value) => updateFilters({ errorType: value })}
				>
					<SelectTrigger className="w-[180px]">
						<SelectValue placeholder="Filter by error" />
					</SelectTrigger>
					<SelectContent>
						{LOG_ERROR_TYPES.map((value) => (
							<SelectItem key={value} value={value}>
								{LOG_ERROR_TYPE_LABELS[value]}
							</SelectItem>
						))}
					</SelectContent>
				</Select>

				<Button
					type="button"
					variant="outline"
					size="sm"
					disabled={loading || loadingMore || refreshing}
					onClick={() => void loadLogs(undefined, { background: true })}
					className="gap-2"
				>
					<RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
					{refreshing ? "Refreshing..." : "Refresh"}
				</Button>
			</div>

			{loading ? (
				<div className="flex items-center justify-center gap-2 rounded-lg border border-border/60 p-8 text-sm text-muted-foreground">
					<Loader2 className="h-4 w-4 animate-spin" />
					Loading logs...
				</div>
			) : logs.length === 0 ? (
				<div className="rounded-lg border border-dashed border-border/60 p-8 text-center text-sm text-muted-foreground">
					{projectId
						? "No logs found for this project."
						: "No logs found for this organization."}
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
