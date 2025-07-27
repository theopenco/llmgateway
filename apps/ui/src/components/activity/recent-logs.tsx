import { models, providers } from "@llmgateway/models";
import { useState } from "react";

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
import { useDashboardContext } from "@/lib/dashboard-context";
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

export function RecentLogs() {
	const [dateRange, setDateRange] = useState<DateRange | undefined>();
	const [finishReason, setFinishReason] = useState<string | undefined>();
	const [unifiedFinishReason, setUnifiedFinishReason] = useState<
		string | undefined
	>();
	const [provider, setProvider] = useState<string | undefined>();
	const [model, setModel] = useState<string | undefined>();
	const { selectedProject } = useDashboardContext();
	const api = useApi();

	const { data, isLoading, error } = api.useQuery(
		"get",
		"/logs",
		{
			params: {
				query: {
					orderBy: "createdAt_desc",
					startDate: dateRange?.start
						? dateRange.start.toISOString()
						: undefined,
					endDate: dateRange?.end ? dateRange.end.toISOString() : undefined,
					finishReason,
					unifiedFinishReason,
					provider,
					model,
					...(selectedProject?.id ? { projectId: selectedProject.id } : {}),
				},
			},
		},
		{
			enabled: !!selectedProject?.id,
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
		<div className="space-y-4 max-w-full overflow-hidden">
			<div className="flex flex-wrap gap-2 mb-4">
				<DateRangeSelect onChange={handleDateRangeChange} value="24h" />

				<Select onValueChange={setFinishReason} value={finishReason}>
					<SelectTrigger>
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
					onValueChange={setUnifiedFinishReason}
					value={unifiedFinishReason}
				>
					<SelectTrigger>
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

				<Select onValueChange={setProvider} value={provider}>
					<SelectTrigger>
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

				<Select onValueChange={setModel} value={model}>
					<SelectTrigger>
						<SelectValue placeholder="Filter by model" />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="all">All models</SelectItem>
						{models.map((m) => (
							<SelectItem key={m.id} value={m.id}>
								{m.id}
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
									messages: log.messages as any,
									tools: (log as any).tools,
									toolChoice: (log as any).toolChoice,
									errorDetails: log.errorDetails as any,
									reasoningTokens: log.reasoningTokens,
									reasoningContent: (log as any).reasoningContent,
									cachedTokens: (log as any).cachedTokens || null,
									cachedInputCost: (log as any).cachedInputCost || null,
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
