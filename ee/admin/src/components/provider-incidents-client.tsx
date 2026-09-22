"use client";

import { keepPreviousData } from "@tanstack/react-query";
import {
	AlertTriangle,
	ChevronDown,
	ChevronRight,
	Loader2,
	X,
} from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Fragment, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import {
	ErrorDetails,
	errorRateClass,
	percentFormatter,
} from "@/components/unstable-mappings-table";
import { useApi } from "@/lib/fetch-client";
import { cn } from "@/lib/utils";

import {
	getProviderIcon,
	INCIDENT_BREAKDOWN_DESCRIPTION,
	INCIDENT_BREAKDOWN_HEADER,
	otherErrorCount,
} from "@llmgateway/shared";
import { formatNumber } from "@llmgateway/shared/number-format";

import type { paths } from "@/lib/api/v1";

type IncidentsWindow = NonNullable<
	paths["/admin/airside/incidents"]["get"]["parameters"]["query"]["window"]
>;

const WINDOWS: IncidentsWindow[] = ["1h", "4h", "24h", "3d"];
const ALL_MAPPINGS = "__all__";
// Mirrors the carrier's Airside view: every non-client error, BYOK included,
// no expected-error matchers.
const DRILLDOWN_LOG_LIMIT = 500;

/** The carrier's Airside Incidents view, scoped to one provider. */
export function ProviderIncidentsClient({
	providerId,
}: {
	providerId: string;
}) {
	const $api = useApi();
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const mapping = searchParams.get("mapping");
	const [timeWindow, setTimeWindow] = useState<IncidentsWindow>("24h");
	const [includeRetried, setIncludeRetried] = useState(true);
	const [expanded, setExpanded] = useState<string | null>(null);

	const queryOptions = {
		refetchInterval: 15_000,
		refetchIntervalInBackground: false,
		placeholderData: keepPreviousData,
	};
	const allQuery = $api.useQuery(
		"get",
		"/admin/airside/incidents",
		{ params: { query: { providerId, window: timeWindow } } },
		queryOptions,
	);
	const filteredQuery = $api.useQuery(
		"get",
		"/admin/airside/incidents",
		{
			params: {
				query: { providerId, window: timeWindow, mapping: mapping ?? "" },
			},
		},
		{ ...queryOptions, enabled: mapping !== null },
	);
	const activeQuery = mapping !== null ? filteredQuery : allQuery;
	const data = activeQuery.data;
	const refreshing = activeQuery.isPlaceholderData;
	const rows = data?.mappings ?? [];
	const openKey =
		expanded ??
		(mapping !== null && rows.length === 1 ? rows[0].usedModel : null);

	const mappingOptions = allQuery.data?.mappings.map((row) => row.usedModel);
	if (mapping !== null && mappingOptions && !mappingOptions.includes(mapping)) {
		mappingOptions.unshift(mapping);
	}

	function setMapping(next: string | null) {
		const params = new URLSearchParams(searchParams.toString());
		if (next) {
			params.set("mapping", next);
		} else {
			params.delete("mapping");
		}
		setExpanded(null);
		const qs = params.toString();
		router.replace(qs ? `${pathname}?${qs}` : pathname);
	}

	const ProviderIcon = getProviderIcon(providerId);

	return (
		<>
			<header className="flex flex-col items-start justify-between gap-4 lg:flex-row lg:items-center">
				<div className="flex items-start gap-3">
					<ProviderIcon className="mt-1 h-8 w-8 shrink-0 dark:text-white" />
					<div>
						<h1 className="flex items-center gap-2 text-3xl font-semibold tracking-tight">
							Incidents
							{refreshing && (
								<span className="flex items-center gap-1 text-xs font-normal text-muted-foreground">
									<Loader2 className="h-3.5 w-3.5 animate-spin" />
									Updating…
								</span>
							)}
						</h1>
						<p className="mt-1 text-sm text-muted-foreground">
							What the carrier sees in Airside for{" "}
							<span className="font-mono">{providerId}</span>: failed requests
							over the last {timeWindow}. {INCIDENT_BREAKDOWN_DESCRIPTION}{" "}
							Counts include retried attempts; expand a row for the top error
							shapes.
						</p>
					</div>
				</div>
				<div className="flex shrink-0 items-center gap-1">
					{WINDOWS.map((value) => (
						<Button
							key={value}
							size="sm"
							variant={timeWindow === value ? "default" : "outline"}
							onClick={() => {
								setExpanded(null);
								setTimeWindow(value);
							}}
						>
							{value}
						</Button>
					))}
				</div>
			</header>

			<div className="flex flex-wrap items-center gap-4">
				<Select
					disabled={!allQuery.data}
					value={mapping ?? ALL_MAPPINGS}
					onValueChange={(value) =>
						setMapping(value === ALL_MAPPINGS ? null : value)
					}
				>
					<SelectTrigger className="h-8 w-72 font-mono text-xs">
						<SelectValue
							placeholder={allQuery.data ? "All mappings" : "Loading mappings…"}
						/>
					</SelectTrigger>
					<SelectContent>
						<SelectItem value={ALL_MAPPINGS}>All mappings</SelectItem>
						{mappingOptions?.map((option) => (
							<SelectItem
								key={option}
								value={option}
								className="font-mono text-xs"
							>
								{option}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				{mapping !== null && (
					<Button
						size="sm"
						variant="secondary"
						onClick={() => setMapping(null)}
					>
						<span className="font-mono text-xs">{mapping}</span>
						<X className="h-3.5 w-3.5" aria-label="Clear mapping filter" />
					</Button>
				)}
				<div className="flex items-center gap-2">
					<Switch
						id="include-retried"
						checked={includeRetried}
						onCheckedChange={setIncludeRetried}
					/>
					<Label htmlFor="include-retried" className="text-xs">
						Retried errors in details
					</Label>
				</div>
			</div>

			{activeQuery.isError && (
				<div
					role="alert"
					className="flex items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm"
				>
					<span className="flex items-center gap-2">
						<AlertTriangle className="h-4 w-4 text-destructive" />
						{data
							? "Couldn't refresh incidents — showing the last loaded data."
							: "Couldn't load incidents."}
					</span>
					<Button
						size="sm"
						variant="outline"
						disabled={activeQuery.isFetching}
						onClick={() => void activeQuery.refetch()}
					>
						{activeQuery.isFetching && (
							<Loader2 className="h-3.5 w-3.5 animate-spin" />
						)}
						Retry
					</Button>
				</div>
			)}

			<div
				className={cn(
					"min-w-0 overflow-x-auto rounded-lg border border-border/60 bg-card transition-opacity",
					refreshing && "pointer-events-none opacity-50",
				)}
				aria-busy={refreshing || activeQuery.isLoading}
			>
				{!data ? (
					activeQuery.isError ? null : (
						<div className="space-y-3 p-4">
							<p className="flex items-center gap-2 text-xs text-muted-foreground">
								<Loader2 className="h-3.5 w-3.5 animate-spin" />
								Loading incidents — longer windows can take a few seconds…
							</p>
							{[0, 1, 2, 3].map((i) => (
								<Skeleton key={i} className="h-9 w-full" />
							))}
						</div>
					)
				) : rows.length === 0 ? (
					<div className="p-8 text-center text-sm text-muted-foreground">
						No errors in this window.
					</div>
				) : (
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead className="w-8" />
								<TableHead>Model</TableHead>
								<TableHead className="text-right">Error Rate</TableHead>
								<TableHead className="text-right">Errors</TableHead>
								<TableHead className="text-right">
									{INCIDENT_BREAKDOWN_HEADER}
								</TableHead>
								<TableHead className="text-right">Requests</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{rows.map((row) => {
								const isOpen = openKey === row.usedModel;
								return (
									<Fragment key={row.usedModel}>
										<TableRow>
											<TableCell>
												<button
													type="button"
													className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted"
													aria-label={
														isOpen
															? "Collapse error details"
															: "Expand error details"
													}
													aria-expanded={isOpen}
													onClick={() =>
														setExpanded(isOpen ? "" : row.usedModel)
													}
												>
													{isOpen ? (
														<ChevronDown className="h-4 w-4" />
													) : (
														<ChevronRight className="h-4 w-4" />
													)}
												</button>
											</TableCell>
											<TableCell className="font-mono text-xs">
												{row.modelId}
												{row.region && (
													<span className="text-muted-foreground">
														:{row.region}
													</span>
												)}
											</TableCell>
											<TableCell className="text-right">
												<Badge
													className={cn(
														"font-semibold tabular-nums",
														row.errorCount === 0
															? "bg-muted text-muted-foreground"
															: errorRateClass(row.errorRate),
													)}
												>
													{percentFormatter.format(row.errorRate)}
												</Badge>
											</TableCell>
											<TableCell className="text-right tabular-nums">
												{formatNumber(row.errorCount)}
											</TableCell>
											<TableCell className="text-right tabular-nums text-muted-foreground">
												{formatNumber(row.upstreamErrorCount)} /{" "}
												{formatNumber(row.gatewayErrorCount)} /{" "}
												{formatNumber(otherErrorCount(row))}
											</TableCell>
											<TableCell className="text-right tabular-nums text-muted-foreground">
												{formatNumber(row.requestCount)}
											</TableCell>
										</TableRow>
										{isOpen && (
											<TableRow className="hover:bg-transparent">
												<TableCell colSpan={6} className="bg-muted/20 p-0">
													<ErrorDetails
														usedModel={row.usedModel}
														provider={row.providerId}
														providerKeyId={undefined}
														includeRetried={includeRetried}
														window={timeWindow}
														logLimit={DRILLDOWN_LOG_LIMIT}
														ignoreExpected={false}
														includeByok
													/>
												</TableCell>
											</TableRow>
										)}
									</Fragment>
								);
							})}
						</TableBody>
					</Table>
				)}
			</div>
		</>
	);
}
