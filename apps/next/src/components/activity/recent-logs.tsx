import { models, providers } from "@llmgateway/models";
import { useCallback, useLayoutEffect, useRef, useState } from "react";

import { LogCard } from "../dashboard/log-card";
import {
	type DateRange,
	DateRangeSelect,
} from "@/components/date-range-select";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/lib/components/select";
import { useDashboardState } from "@/lib/dashboard-state";
import { useApi } from "@/lib/fetch-client";

const UnifiedFinishReason = {
	COMPLETED: "completed",
	LENGTH_LIMIT: "length_limit",
	CONTENT_FILTER: "content_filter",
	GATEWAY_ERROR: "gateway_error",
	UPSTREAM_ERROR: "upstream_error",
	CANCELED: "canceled",
	UNKNOWN: "unknown",
} as const;
const FINISH_REASONS = ["stop", "length", "error", "content_filter"];

interface RecentLogsProps {
	initialData?:
		| {
				message?: string;
				logs: {
					id: string;
					requestId: string;
					createdAt: string;
					updatedAt: string;
					organizationId: string;
					projectId: string;
					apiKeyId: string;
					duration: number;
					requestedModel: string;
					requestedProvider: string | null;
					usedModel: string;
					usedProvider: string;
					responseSize: number;
					content: string | null;
					unifiedFinishReason: string | null;
					finishReason: string | null;
					promptTokens: string | null;
					completionTokens: string | null;
					totalTokens: string | null;
					reasoningTokens: string | null;
					messages?: unknown;
					temperature: number | null;
					maxTokens: number | null;
					topP: number | null;
					frequencyPenalty: number | null;
					presencePenalty: number | null;
					hasError: boolean | null;
					errorDetails: {
						statusCode: number;
						statusText: string;
						responseText: string;
					} | null;
					cost: number | null;
					inputCost: number | null;
					outputCost: number | null;
					requestCost: number | null;
					estimatedCost: boolean | null;
					canceled: boolean | null;
					streamed: boolean | null;
					cached: boolean | null;
					mode: "api-keys" | "credits" | "hybrid";
					usedMode: "api-keys" | "credits";
				}[];
				pagination: {
					nextCursor: string | null;
					hasMore: boolean;
					limit: number;
				};
		  }
		| undefined;
}

export function RecentLogs({ initialData }: RecentLogsProps) {
	const [dateRange, setDateRange] = useState<DateRange | undefined>();
	const [finishReason, setFinishReason] = useState<string | undefined>();
	const [unifiedFinishReason, setUnifiedFinishReason] = useState<
		string | undefined
	>();
	const [provider, setProvider] = useState<string | undefined>();
	const [model, setModel] = useState<string | undefined>();
	const { selectedProject } = useDashboardState();
	const api = useApi();
	const scrollPositionRef = useRef<number>(0);
	const isFilteringRef = useRef<boolean>(false);

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

	// Prevent scroll jumping when filters change
	const handleFilterChange = useCallback(
		(setter: (value: string | undefined) => void) => {
			return (value: string) => {
				// Mark that we're filtering and save current position
				isFilteringRef.current = true;
				scrollPositionRef.current = window.scrollY;

				// Update state
				setter(value === "all" ? undefined : value);
			};
		},
		[],
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
	if (finishReason && finishReason !== "all") {
		queryParams.finishReason = finishReason;
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
	if (selectedProject?.id) {
		queryParams.projectId = selectedProject.id;
	}

	const { data, isLoading, error } = api.useQuery(
		"get",
		"/logs",
		{
			params: {
				query: queryParams,
			},
		},
		{
			enabled: !!selectedProject?.id,
			initialData:
				!dateRange &&
				!finishReason &&
				!unifiedFinishReason &&
				!provider &&
				!model
					? initialData
					: undefined,
			refetchOnWindowFocus: false,
			staleTime: 0, // Force refetch when filters change
		},
	);

	const handleDateRangeChange = (_value: string, range: DateRange) => {
		setDateRange(range);
	};

	if (!selectedProject) {
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
			<div className="flex flex-wrap gap-2 mb-4 sticky top-0 bg-background z-10 py-2">
				<DateRangeSelect onChange={handleDateRangeChange} value="24h" />

				<Select
					onValueChange={handleFilterChange(setFinishReason)}
					value={finishReason || "all"}
				>
					<SelectTrigger className="w-[180px]">
						<SelectValue placeholder="Filter by reason" />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="all">All reasons</SelectItem>
						{FINISH_REASONS.map((reason) => (
							<SelectItem key={reason} value={reason}>
								{reason}
							</SelectItem>
						))}
					</SelectContent>
				</Select>

				<Select
					onValueChange={handleFilterChange(setUnifiedFinishReason)}
					value={unifiedFinishReason || "all"}
				>
					<SelectTrigger className="w-[200px]">
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

				<Select
					onValueChange={handleFilterChange(setProvider)}
					value={provider || "all"}
				>
					<SelectTrigger className="w-[160px]">
						<SelectValue placeholder="Filter by provider" />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="all">All providers</SelectItem>
						{providers.map((p) => (
							<SelectItem key={p.id} value={p.id}>
								{p.name}
							</SelectItem>
						))}
					</SelectContent>
				</Select>

				<Select
					onValueChange={handleFilterChange(setModel)}
					value={model || "all"}
				>
					<SelectTrigger className="w-[180px]">
						<SelectValue placeholder="Filter by model" />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="all">All models</SelectItem>
						{models.map((m) => (
							<SelectItem key={m.model} value={m.model}>
								{m.model}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>

			{isLoading ? (
				<div>Loading...</div>
			) : error ? (
				<div>Error loading logs</div>
			) : (
				<div className="space-y-4 max-w-full">
					{data?.logs.length ? (
						data.logs.map((log) => (
							<LogCard
								key={log.id}
								log={{
									...log,
									createdAt: new Date(log.createdAt),
									updatedAt: new Date(log.updatedAt),
									messages: log.messages,
									errorDetails: log.errorDetails,
									reasoningTokens: log.reasoningTokens,
								}}
							/>
						))
					) : (
						<div className="py-4 text-center text-muted-foreground">
							No logs found matching the selected filters.
							{selectedProject && (
								<span className="block mt-1 text-sm">
									Project: {selectedProject.name}
								</span>
							)}
						</div>
					)}
				</div>
			)}
		</div>
	);
}
