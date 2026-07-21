"use client";

import {
	Check,
	ChevronsUpDown,
	RefreshCw,
	Search,
	SlidersHorizontal,
	Sparkles,
	X,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import {
	useCallback,
	useDeferredValue,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";

import { TopUpCreditsDialog } from "@/components/credits/top-up-credits-dialog";
import { LogCard } from "@/components/dashboard/log-card";
import {
	type DateRange,
	DateRangeSelect,
} from "@/components/date-range-select";
import { Badge } from "@/lib/components/badge";
import { Button } from "@/lib/components/button";
import {
	Command,
	CommandEmpty,
	CommandInput,
	CommandItem,
	CommandList,
} from "@/lib/components/command";
import { Input } from "@/lib/components/input";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/lib/components/popover";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/lib/components/select";
import { useApi } from "@/lib/fetch-client";
import { cn } from "@/lib/utils";

import type { paths } from "@/lib/api/v1";
import type { Log } from "@llmgateway/db";

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

type ApiLog =
	paths["/logs"]["get"]["responses"][200]["content"]["application/json"]["logs"][number];

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

interface RecentLogsProps {
	initialData?:
		| paths["/logs"]["get"]["responses"][200]["content"]["application/json"]
		| undefined;
	providerOptions: ProviderOption[];
	modelOptions: ModelOption[];
	projectId: string | null;
	orgId?: string | null;
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
		toolChoice: log.toolChoice as any,
		customHeaders: log.customHeaders as any,
	};
}

const TOPUP_PROMPT_DISMISSED_KEY = "first-log-topup-dismissed";

function getCookie(name: string): string | undefined {
	if (typeof document === "undefined") {
		return undefined;
	}
	const match = document.cookie.match(
		new RegExp(
			`(?:^|; )${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=([^;]*)`,
		),
	);
	return match ? decodeURIComponent(match[1]!) : undefined;
}

function setCookie(name: string, value: string, days = 365) {
	const ms = days * 86_400_000;
	const expires = new Date(Date.now() + ms).toUTCString();
	document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`;
}

function FirstLogTopUpPrompt() {
	const [dismissed, setDismissed] = useState(true);

	useEffect(() => {
		const stored = getCookie(TOPUP_PROMPT_DISMISSED_KEY);
		if (stored !== "true") {
			setDismissed(false);
		}
	}, []);

	if (dismissed) {
		return null;
	}

	return (
		<div className="mt-4 relative overflow-hidden rounded-lg border border-primary/20 bg-gradient-to-r from-primary/5 via-primary/10 to-primary/5 p-4">
			<button
				type="button"
				aria-label="Dismiss top-up prompt"
				onClick={() => {
					setDismissed(true);
					setCookie(TOPUP_PROMPT_DISMISSED_KEY, "true");
				}}
				className="absolute right-2 top-2 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
			>
				<X className="h-4 w-4" />
			</button>
			<div className="flex items-start gap-3 pr-6">
				<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10">
					<Sparkles className="h-4 w-4 text-primary" />
				</div>
				<div className="flex-1">
					<p className="text-sm font-semibold">Your first API call worked!</p>
					<p className="mt-1 text-sm text-muted-foreground">
						Top up credits to unlock paid models with higher quality, faster
						speeds, and larger context windows.
					</p>
					<div className="mt-3">
						<TopUpCreditsDialog>
							<Button size="sm">
								<Sparkles className="mr-2 h-3.5 w-3.5" />
								Top Up Credits
							</Button>
						</TopUpCreditsDialog>
					</div>
				</div>
			</div>
		</div>
	);
}

export function RecentLogs({
	initialData,
	providerOptions,
	modelOptions,
	projectId,
	orgId,
}: RecentLogsProps) {
	const router = useRouter();
	const searchParams = useSearchParams();
	const [modelPickerOpen, setModelPickerOpen] = useState(false);
	const [modelSearch, setModelSearch] = useState("");
	const [dateRangeResetKey, setDateRangeResetKey] = useState(0);

	// Initialize state from URL parameters
	const [dateRange, setDateRange] = useState<DateRange | undefined>();
	const [unifiedFinishReason, setUnifiedFinishReason] = useState<
		string | undefined
	>(searchParams.get("unifiedFinishReason") ?? undefined);
	const [provider, setProvider] = useState<string | undefined>(
		searchParams.get("provider") ?? undefined,
	);
	const [model, setModel] = useState<string | undefined>(
		searchParams.get("model") ?? undefined,
	);
	const [customHeaderKey, setCustomHeaderKey] = useState<string>(
		searchParams.get("customHeaderKey") ?? "",
	);
	const [customHeaderValue, setCustomHeaderValue] = useState<string>(
		searchParams.get("customHeaderValue") ?? "",
	);
	const [sessionId, setSessionId] = useState<string>(
		searchParams.get("sessionId") ?? "",
	);
	const [apiKeyId, setApiKeyId] = useState<string | undefined>(
		searchParams.get("apiKeyId") ?? undefined,
	);

	const api = useApi();
	const deferredModelSearch = useDeferredValue(modelSearch);

	const { data: apiKeysData } = api.useQuery(
		"get",
		"/keys/api",
		{ params: { query: { projectId: projectId ?? "" } } },
		{
			enabled: !!projectId,
			staleTime: 5 * 60 * 1000,
			refetchOnWindowFocus: false,
		},
	);

	const apiKeyOptions = useMemo(
		() =>
			(apiKeysData?.apiKeys ?? [])
				.filter((key) => key.status !== "deleted")
				.map((key) => ({
					id: key.id,
					label: key.description || key.maskedToken,
				})),
		[apiKeysData],
	);

	const scrollPositionRef = useRef<number>(0);
	const isFilteringRef = useRef<boolean>(false);

	// Function to update URL with new filter parameters
	const updateUrlWithFilters = useCallback(
		(newParams: Record<string, string | undefined>) => {
			const params = new URLSearchParams(searchParams.toString());

			// Update or remove parameters
			Object.entries(newParams).forEach(([key, value]) => {
				if (value && value !== "all") {
					params.set(key, value);
				} else {
					params.delete(key);
				}
			});

			// Update URL without triggering a page reload
			router.push(`?${params.toString()}`, { scroll: false });
		},
		[router, searchParams],
	);

	// Track scroll position
	useLayoutEffect(() => {
		const handleScroll = () => {
			if (!isFilteringRef.current) {
				scrollPositionRef.current = window.scrollY;
			}
		};

		window.addEventListener("scroll", handleScroll, { passive: true });
		return () => window.removeEventListener("scroll", handleScroll);
	}, []);

	// Restore scroll position after filter changes
	useLayoutEffect(() => {
		if (isFilteringRef.current) {
			window.scrollTo(0, scrollPositionRef.current);
			isFilteringRef.current = false;
		}
	});

	// Updated filter change handler that updates URL
	const handleFilterChange = useCallback(
		(filterKey: string, setter: (value: string | undefined) => void) => {
			return (value: string) => {
				// Mark that we're filtering and save current position
				isFilteringRef.current = true;
				scrollPositionRef.current = window.scrollY;

				const filterValue = value === "all" ? undefined : value;

				// Update state
				setter(filterValue);

				// Update URL
				updateUrlWithFilters({ [filterKey]: filterValue });
			};
		},
		[updateUrlWithFilters],
	);

	// Build query parameters - only include defined values
	const queryParams: Record<string, string> = {
		orderBy: "createdAt_desc",
	};

	if (dateRange?.start) {
		queryParams.startDate = dateRange.start.toISOString();
	}
	if (dateRange?.end) {
		queryParams.endDate = dateRange.end.toISOString();
	}
	if (unifiedFinishReason && unifiedFinishReason !== "all") {
		queryParams.unifiedFinishReason = unifiedFinishReason;
	}
	if (provider && provider !== "all") {
		queryParams.provider = provider;
	}
	if (model && model !== "all") {
		queryParams.model = model;
	}
	if (customHeaderKey.trim()) {
		queryParams.customHeaderKey = customHeaderKey.trim();
	}
	if (customHeaderValue.trim()) {
		queryParams.customHeaderValue = customHeaderValue.trim();
	}
	if (sessionId.trim()) {
		queryParams.sessionId = sessionId.trim();
	}
	if (apiKeyId && apiKeyId !== "all") {
		queryParams.apiKeyId = apiKeyId;
	}
	if (projectId) {
		queryParams.projectId = projectId;
	}

	const shouldUseInitialData =
		!dateRange &&
		unifiedFinishReason ===
			(searchParams.get("unifiedFinishReason") ?? undefined) &&
		provider === (searchParams.get("provider") ?? undefined) &&
		model === (searchParams.get("model") ?? undefined) &&
		customHeaderKey === (searchParams.get("customHeaderKey") ?? "") &&
		customHeaderValue === (searchParams.get("customHeaderValue") ?? "") &&
		sessionId === (searchParams.get("sessionId") ?? "") &&
		apiKeyId === (searchParams.get("apiKeyId") ?? undefined);

	const {
		data,
		isLoading,
		isRefetching,
		error,
		fetchNextPage,
		hasNextPage,
		isFetchingNextPage,
		refetch,
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
			initialData:
				shouldUseInitialData && initialData
					? {
							pages: [initialData],
							pageParams: [undefined],
						}
					: undefined,
			initialPageParam: undefined,
			refetchOnWindowFocus: false,
			staleTime: 5 * 60 * 1000, // 5 minutes to prevent unnecessary refetches
			getNextPageParam: (lastPage) => {
				return lastPage?.pagination?.hasMore
					? lastPage.pagination.nextCursor
					: undefined;
			},
		},
	);

	// Flatten all pages into a single array of logs, hiding retried requests
	const allLogs = (
		data?.pages.flatMap((page) => page?.logs ?? []) ?? []
	).filter((log) => !log.retriedByLogId);

	const successfulLogs = allLogs.filter(
		(log) => !log.hasError && !log.canceled,
	);
	const showTopUpPrompt =
		allLogs.length <= 5 &&
		successfulLogs.length > 0 &&
		successfulLogs.every((log) => log.cost === 0);

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
			if (provider && !option.providerIds.includes(provider)) {
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

	const handleDateRangeChange = (_value: string, range: DateRange) => {
		setDateRange(range);
		// Update URL with date range
		updateUrlWithFilters({
			startDate: range.start?.toISOString(),
			endDate: range.end?.toISOString(),
		});
	};

	const handleProviderChange = useCallback(
		(value: string) => {
			isFilteringRef.current = true;
			scrollPositionRef.current = window.scrollY;

			const nextProvider = value === "all" ? undefined : value;
			const shouldClearModel =
				model !== undefined &&
				nextProvider !== undefined &&
				!modelOptions.some(
					(option) =>
						option.id === model && option.providerIds.includes(nextProvider),
				);

			setProvider(nextProvider);
			if (shouldClearModel) {
				setModel(undefined);
			}

			updateUrlWithFilters({
				provider: nextProvider,
				model: shouldClearModel ? undefined : model,
			});
		},
		[model, modelOptions, updateUrlWithFilters],
	);

	const activeFilterCount = [
		dateRange,
		unifiedFinishReason,
		provider,
		model,
		apiKeyId,
		customHeaderKey.trim() || undefined,
		customHeaderValue.trim() || undefined,
		sessionId.trim() || undefined,
	].filter(Boolean).length;

	const clearAllFilters = useCallback(() => {
		isFilteringRef.current = true;
		scrollPositionRef.current = window.scrollY;
		setDateRange(undefined);
		setDateRangeResetKey((key) => key + 1);
		setUnifiedFinishReason(undefined);
		setProvider(undefined);
		setModel(undefined);
		setApiKeyId(undefined);
		setCustomHeaderKey("");
		setCustomHeaderValue("");
		setSessionId("");
		updateUrlWithFilters({
			startDate: undefined,
			endDate: undefined,
			unifiedFinishReason: undefined,
			provider: undefined,
			model: undefined,
			apiKeyId: undefined,
			customHeaderKey: undefined,
			customHeaderValue: undefined,
			sessionId: undefined,
		});
	}, [updateUrlWithFilters]);

	if (!projectId) {
		return (
			<div className="py-8 text-center text-muted-foreground">
				<p>Please select a project to view recent logs.</p>
			</div>
		);
	}

	return (
		<div
			className="space-y-4 max-w-full overflow-hidden"
			style={{ scrollBehavior: "auto" }}
		>
			<div className="sticky top-0 z-10 pb-1 pt-1">
				<div className="rounded-xl border bg-card/95 p-3 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-card/85">
					<div className="mb-3 flex flex-wrap items-center justify-between gap-2">
						<div className="flex items-center gap-2">
							<SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
							<span className="text-sm font-medium">Filters</span>
							{activeFilterCount > 0 && (
								<Badge
									variant="secondary"
									className="h-5 rounded-full px-2 text-xs font-normal"
								>
									{activeFilterCount} active
								</Badge>
							)}
						</div>
						<div className="flex items-center gap-1.5">
							{activeFilterCount > 0 && (
								<Button
									type="button"
									variant="ghost"
									size="sm"
									onClick={clearAllFilters}
									className="h-8 gap-1.5 text-muted-foreground"
								>
									<X className="h-3.5 w-3.5" />
									Reset
								</Button>
							)}
							<Button
								type="button"
								variant="outline"
								size="sm"
								onClick={() => void refetch()}
								disabled={isLoading || isRefetching || isFetchingNextPage}
								className="h-8 gap-1.5"
							>
								<RefreshCw
									className={cn("h-3.5 w-3.5", isRefetching && "animate-spin")}
								/>
								{isRefetching ? "Refreshing..." : "Refresh"}
							</Button>
						</div>
					</div>

					<div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
						<DateRangeSelect
							key={dateRangeResetKey}
							onChange={handleDateRangeChange}
							className="w-full"
						/>

						<Select
							onValueChange={handleProviderChange}
							value={provider ?? "all"}
						>
							<SelectTrigger className="w-full">
								<SelectValue placeholder="Filter by provider" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="all">All providers</SelectItem>
								{providerOptions.map((option) => (
									<SelectItem key={option.id} value={option.id}>
										{option.label}
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
									className={cn(
										"w-full justify-between font-normal",
										!model && "text-muted-foreground",
									)}
								>
									<span className="truncate">
										{selectedModelOption?.label ?? model ?? "All models"}
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
												handleFilterChange("model", setModel)("all");
												setModelPickerOpen(false);
												setModelSearch("");
											}}
										>
											<Check
												className={cn(
													"h-4 w-4",
													!model ? "opacity-100" : "opacity-0",
												)}
											/>
											All models
										</CommandItem>
										{filteredModelOptions.map((option) => (
											<CommandItem
												key={option.id}
												value={`${option.id} ${option.label} ${option.aliases.join(" ")}`}
												onSelect={() => {
													handleFilterChange("model", setModel)(option.id);
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
							onValueChange={handleFilterChange("apiKeyId", setApiKeyId)}
							value={apiKeyId ?? "all"}
						>
							<SelectTrigger className="w-full">
								<SelectValue placeholder="Filter by API key" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="all">All API keys</SelectItem>
								{apiKeyOptions.map((option) => (
									<SelectItem key={option.id} value={option.id}>
										{option.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>

						<Select
							onValueChange={handleFilterChange(
								"unifiedFinishReason",
								setUnifiedFinishReason,
							)}
							value={unifiedFinishReason ?? "all"}
						>
							<SelectTrigger className="w-full">
								<SelectValue placeholder="Filter by unified reason" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="all">All unified reasons</SelectItem>
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

						<div className="relative">
							<Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
							<Input
								placeholder="Header key (e.g. uid)"
								value={customHeaderKey}
								onChange={(e) => {
									isFilteringRef.current = true;
									scrollPositionRef.current = window.scrollY;
									setCustomHeaderKey(e.target.value);
									updateUrlWithFilters({
										customHeaderKey: e.target.value ?? undefined,
									});
								}}
								className="w-full pl-8"
							/>
						</div>

						<div className="relative">
							<Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
							<Input
								placeholder="Header value (e.g. 12345)"
								value={customHeaderValue}
								onChange={(e) => {
									isFilteringRef.current = true;
									scrollPositionRef.current = window.scrollY;
									setCustomHeaderValue(e.target.value);
									updateUrlWithFilters({
										customHeaderValue: e.target.value ?? undefined,
									});
								}}
								className="w-full pl-8"
							/>
						</div>

						<div className="relative">
							<Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
							<Input
								placeholder="Session ID"
								value={sessionId}
								onChange={(e) => {
									isFilteringRef.current = true;
									scrollPositionRef.current = window.scrollY;
									setSessionId(e.target.value);
									updateUrlWithFilters({
										sessionId: e.target.value ?? undefined,
									});
								}}
								className="w-full pl-8"
							/>
						</div>
					</div>
				</div>
			</div>

			{isLoading ? (
				<div>Loading...</div>
			) : error ? (
				<div>Error loading logs</div>
			) : (
				<div className="space-y-4 @container">
					{allLogs.map((log, index) => (
						<div key={log.id}>
							<LogCard
								log={toUiLog(log)}
								orgId={orgId ?? undefined}
								projectId={projectId || undefined}
							/>
							{index === 0 && showTopUpPrompt && <FirstLogTopUpPrompt />}
						</div>
					))}

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

					{allLogs.length === 0 && !hasNextPage && (
						<div className="py-4 text-center text-muted-foreground">
							No logs found matching the selected filters.
							{projectId && (
								<span className="block mt-1 text-sm">Project: {projectId}</span>
							)}
						</div>
					)}
				</div>
			)}
		</div>
	);
}
