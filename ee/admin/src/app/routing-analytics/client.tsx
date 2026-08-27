"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";
import {
	Bar,
	BarChart,
	CartesianGrid,
	Line,
	LineChart,
	XAxis,
	YAxis,
} from "recharts";

import { StatCard } from "@/components/detail-stat-cards";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	ChartContainer,
	ChartLegend,
	ChartLegendContent,
	ChartTooltip,
	ChartTooltipContent,
} from "@/components/ui/chart";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { useApi } from "@/lib/fetch-client";
import { cn } from "@/lib/utils";

import { models, providers } from "@llmgateway/models";
import {
	formatMappingValue,
	ModelMappingSelector,
	parseMappingValue,
} from "@llmgateway/shared/components";
import { isDeactivationScheduledSoon } from "@llmgateway/shared/deactivation";
import {
	ROUTING_EXCLUSION_REASON_LABELS,
	ROUTING_SELECTION_KIND_LABELS,
	ROUTING_SELECTION_REASON_LABELS,
} from "@llmgateway/shared/routing-telemetry";

import type { ChartConfig } from "@/components/ui/chart";
import type {
	RoutingExclusionReason,
	RoutingSelectionKind,
	RoutingSelectionReason,
} from "@llmgateway/shared/routing-telemetry";

type RoutingWindow = "24h" | "3d" | "7d";

const WINDOW_OPTIONS: { value: RoutingWindow; label: string }[] = [
	{ value: "24h", label: "24 hours" },
	{ value: "3d", label: "3 days" },
	{ value: "7d", label: "7 days" },
];

type MetricKey = "score" | "uptime" | "latency" | "throughput";

const METRIC_OPTIONS: {
	value: MetricKey;
	label: string;
	description: string;
}[] = [
	{
		value: "score",
		label: "Routing score",
		description:
			"Weighted score the router assigns each mapping per hourly bucket — the lowest score wins the election.",
	},
	{
		value: "uptime",
		label: "Uptime",
		description:
			"Successful requests / total requests per hour (client 4xx errors don't count against a provider).",
	},
	{
		value: "latency",
		label: "Latency (TTFT)",
		description:
			"Average time to first token in ms, from streamed requests only.",
	},
	{
		value: "throughput",
		label: "Throughput",
		description: "Output tokens per second across the hourly bucket.",
	},
];

// Fixed hues per election kind so the proportion bar, the per-hour chart and the
// legend all agree. `scored` is the only kind where the score decided anything,
// so it gets the one calm color and everything else reads as a deviation.
const ELECTION_KIND_COLORS: Record<string, string> = {
	scored: "hsl(142 71% 45%)",
	pinned: "hsl(221 83% 53%)",
	narrowed: "hsl(32 95% 44%)",
	"single-candidate": "hsl(215 16% 47%)",
	sticky: "hsl(280 65% 60%)",
	fallback: "hsl(0 72% 51%)",
	exploration: "hsl(189 94% 43%)",
	unknown: "hsl(215 16% 47%)",
};

// Distinct, color-blind-friendly hues. Repeat for >12 series.
const SERIES_COLORS = [
	"hsl(221 83% 53%)",
	"hsl(142 71% 45%)",
	"hsl(32 95% 44%)",
	"hsl(280 65% 60%)",
	"hsl(0 72% 51%)",
	"hsl(189 94% 43%)",
	"hsl(340 75% 55%)",
	"hsl(48 96% 53%)",
	"hsl(160 60% 45%)",
	"hsl(258 76% 58%)",
	"hsl(15 86% 55%)",
	"hsl(200 60% 40%)",
];

// Buckets are UTC hour boundaries, so they are rendered in UTC too — a
// browser-local render would put the labels off the hour and disagree with the
// "UTC" suffix on the tooltips.
const AXIS_HOUR_FORMATTER = new Intl.DateTimeFormat("en-US", {
	timeZone: "UTC",
	month: "short",
	day: "numeric",
	hour: "2-digit",
	minute: "2-digit",
	hour12: false,
});

const TOOLTIP_HOUR_FORMATTER = new Intl.DateTimeFormat("en-US", {
	timeZone: "UTC",
	year: "numeric",
	month: "short",
	day: "numeric",
	hour: "2-digit",
	minute: "2-digit",
	hour12: false,
});

const numberFormatter = new Intl.NumberFormat("en-US", {
	maximumFractionDigits: 0,
});

function formatAxisHour(value: string): string {
	return AXIS_HOUR_FORMATTER.format(new Date(value));
}

function formatTooltipHour(value: string): string {
	return `${TOOLTIP_HOUR_FORMATTER.format(new Date(value))} UTC`;
}

function parseWindow(value: string | null): RoutingWindow {
	return WINDOW_OPTIONS.some((o) => o.value === value)
		? (value as RoutingWindow)
		: "3d";
}

function parseMetric(value: string | null): MetricKey {
	return METRIC_OPTIONS.some((o) => o.value === value)
		? (value as MetricKey)
		: "score";
}

function formatMetricValue(metric: MetricKey, value: number): string {
	switch (metric) {
		case "score":
			return value.toFixed(3);
		case "uptime":
			return `${value.toFixed(1)}%`;
		case "latency":
			return `${Math.round(value)} ms`;
		case "throughput":
			return `${value.toFixed(1)} tok/s`;
	}
}

function formatSelectionPrice(price: number, isImageModel: boolean): string {
	if (price === 0) {
		return "free";
	}
	if (isImageModel) {
		return `$${price.toFixed(4)}/image`;
	}
	return `$${(price * 1e6).toFixed(2)}/M`;
}

function formatDeactivationDate(value: string | null): string {
	if (!value) {
		return "";
	}
	// Catalogue deactivation dates are UTC-midnight calendar dates, not instants:
	// rendering them in the viewer's zone shows the previous day west of UTC.
	return new Date(value).toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		timeZone: "UTC",
	});
}

function formatContribution(value: number): string {
	if (value === 0) {
		return "—";
	}
	return value > 0 ? `+${value.toFixed(3)}` : value.toFixed(3);
}

// Pseudo entries that are never routed across providers.
const EXCLUDED_MODEL_IDS = new Set(["auto", "custom"]);

function EmptyState({ children }: { children: React.ReactNode }) {
	return (
		<div className="flex h-[240px] items-center justify-center rounded-lg border border-dashed border-border/60 bg-card text-sm text-muted-foreground">
			{children}
		</div>
	);
}

function formatPercent(value: number, total: number): string {
	if (total <= 0) {
		return "—";
	}
	return `${((value / total) * 100).toFixed(1)}%`;
}

function electionKindLabel(kind: string): string {
	return ROUTING_SELECTION_KIND_LABELS[kind as RoutingSelectionKind] ?? kind;
}

function electionKindColor(kind: string): string {
	return ELECTION_KIND_COLORS[kind] ?? ELECTION_KIND_COLORS.unknown;
}

function exclusionReasonLabel(reason: string): string {
	return (
		ROUTING_EXCLUSION_REASON_LABELS[reason as RoutingExclusionReason] ?? reason
	);
}

/**
 * Single-row stacked proportion bar. Used for the election-path and service-tier
 * splits, where the shares matter more than absolute counts and a full chart
 * would bury a three-segment comparison.
 */
function ProportionBar({
	segments,
	total,
}: {
	segments: { key: string; label: string; value: number; color: string }[];
	total: number;
}) {
	if (total <= 0) {
		return (
			<p className="text-sm text-muted-foreground">
				No routed requests in this window.
			</p>
		);
	}
	const visible = segments.filter((segment) => segment.value > 0);
	return (
		<div className="space-y-3">
			<div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
				{visible.map((segment) => (
					<div
						key={segment.key}
						style={{
							width: `${(segment.value / total) * 100}%`,
							backgroundColor: segment.color,
						}}
						title={`${segment.label}: ${numberFormatter.format(segment.value)}`}
					/>
				))}
			</div>
			<div className="flex flex-wrap gap-x-4 gap-y-1.5">
				{visible.map((segment) => (
					<div key={segment.key} className="flex items-center gap-1.5 text-xs">
						<span
							className="h-2.5 w-2.5 shrink-0 rounded-full"
							style={{ backgroundColor: segment.color }}
						/>
						<span>{segment.label}</span>
						<span className="font-mono text-muted-foreground">
							{formatPercent(segment.value, total)}
						</span>
						<span className="font-mono text-muted-foreground">
							({numberFormatter.format(segment.value)})
						</span>
					</div>
				))}
			</div>
		</div>
	);
}

export function RoutingAnalyticsClient() {
	const $api = useApi();
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();

	const modelId = searchParams.get("modelId");
	const selectedProviderId = searchParams.get("providerId");
	const window = parseWindow(searchParams.get("window"));
	const metric = parseMetric(searchParams.get("metric"));

	const updateParams = useCallback(
		(values: Record<string, string | null>) => {
			const params = new URLSearchParams(searchParams.toString());
			for (const [key, value] of Object.entries(values)) {
				if (value === null) {
					params.delete(key);
				} else {
					params.set(key, value);
				}
			}
			router.replace(`${pathname}?${params.toString()}`, { scroll: false });
		},
		[searchParams, router, pathname],
	);

	const selectorValue = modelId
		? selectedProviderId
			? formatMappingValue(selectedProviderId, modelId)
			: modelId
		: null;

	const handleMappingChange = useCallback(
		(value: string) => {
			const parsed = parseMappingValue(value);
			updateParams({
				modelId: parsed.modelId,
				providerId: parsed.providerId,
			});
		},
		[updateParams],
	);

	const selectableModels = useMemo(
		() => models.filter((model) => !EXCLUDED_MODEL_IDS.has(model.id)),
		[],
	);

	const { data, isLoading, isError } = $api.useQuery(
		"get",
		"/admin/routing-analytics",
		{
			params: { query: { modelId: modelId ?? "", window } },
		},
		{ enabled: Boolean(modelId) },
	);

	// Chart every mapping that is either electable or actually saw traffic in
	// the window (a deactivated mapping with residual history stays visible).
	const chartedProviders = useMemo(() => {
		if (!data) {
			return [];
		}
		return data.mappings.filter(
			(mapping) =>
				mapping.routable ||
				(data.summary.find((s) => s.providerId === mapping.providerId)
					?.requestCount ?? 0) > 0,
		);
	}, [data]);

	const chartConfig = useMemo(() => {
		const config: ChartConfig = {};
		chartedProviders.forEach((mapping, index) => {
			config[mapping.providerId] = {
				label: mapping.providerName,
				color: SERIES_COLORS[index % SERIES_COLORS.length],
			};
		});
		return config;
	}, [chartedProviders]);

	const metricChartData = useMemo(() => {
		if (!data) {
			return [];
		}
		return data.hourly.map((hour) => {
			const row: Record<string, string | number | null> = { hour: hour.hour };
			for (const entry of hour.providers) {
				row[entry.providerId] = entry[metric];
			}
			return row;
		});
	}, [data, metric]);

	const trafficChartData = useMemo(() => {
		if (!data) {
			return [];
		}
		return data.hourly.map((hour) => {
			const row: Record<string, string | number> = { hour: hour.hour };
			for (const entry of hour.providers) {
				row[entry.providerId] = entry.requestCount;
			}
			return row;
		});
	}, [data]);

	const totalRequests = useMemo(
		() => data?.summary.reduce((sum, s) => sum + s.requestCount, 0) ?? 0,
		[data],
	);

	const sortedSummary = useMemo(() => {
		if (!data) {
			return [];
		}
		return [...data.summary].sort((a, b) => {
			if (a.score === null && b.score === null) {
				return b.requestCount - a.requestCount;
			}
			if (a.score === null) {
				return 1;
			}
			if (b.score === null) {
				return -1;
			}
			return a.score - b.score;
		});
	}, [data]);

	const scoredSummary = useMemo(
		() => sortedSummary.filter((summary) => summary.score !== null),
		[sortedSummary],
	);

	const electedProviderId = scoredSummary[0]?.providerId ?? null;
	const selectedRank = selectedProviderId
		? scoredSummary.findIndex((s) => s.providerId === selectedProviderId)
		: -1;
	const selectedSummary =
		selectedRank >= 0 ? scoredSummary[selectedRank] : undefined;
	const routableCount =
		data?.mappings.filter((mapping) => mapping.routable).length ?? 0;

	// Only chart kinds that actually occurred, so an untouched path doesn't add an
	// empty legend entry to every model.
	const electionKinds = useMemo(
		() =>
			data?.elections.byKind
				.filter((entry) => entry.requestCount > 0)
				.map((entry) => entry.kind) ?? [],
		[data],
	);

	const electionChartConfig = useMemo(() => {
		const config: ChartConfig = {};
		for (const kind of electionKinds) {
			config[kind] = {
				label: electionKindLabel(kind),
				color: electionKindColor(kind),
			};
		}
		return config;
	}, [electionKinds]);

	const electionChartData = useMemo(() => {
		if (!data) {
			return [];
		}
		return data.hourly.map((hour) => {
			const row: Record<string, string | number> = { hour: hour.hour };
			for (const kind of electionKinds) {
				row[kind] =
					hour.elections.find((entry) => entry.kind === kind)?.requestCount ??
					0;
			}
			return row;
		});
	}, [data, electionKinds]);

	const maxExclusionCount = useMemo(
		() => Math.max(1, ...(data?.exclusions.map((e) => e.excludedCount) ?? [1])),
		[data],
	);

	// The election counts come from routing telemetry, a separate hourly rollup
	// read from `log`, while every other count on this page comes from the
	// mapping rollup. The two totals are therefore close but not identical — an
	// hour whose telemetry never aggregated is simply missing from it — so the
	// gap is stated rather than left for the reader to spot.
	const telemetryCoverageHint = useMemo(() => {
		if (!data || totalRequests <= 0) {
			return undefined;
		}
		const missing = totalRequests - data.elections.requestCount;
		if (missing === 0) {
			return "routing telemetry on every request";
		}
		return missing > 0
			? `${numberFormatter.format(missing)} requests without routing telemetry`
			: `${numberFormatter.format(-missing)} decisions beyond the served requests`;
	}, [data, totalRequests]);

	const untieredRequests = data
		? Math.max(
				data.serviceTier.requestCount -
					data.serviceTier.explicit -
					data.serviceTier.implicit,
				0,
			)
		: 0;

	const metricOption = METRIC_OPTIONS.find((o) => o.value === metric)!;

	const providerName = (providerId: string) =>
		data?.mappings.find((m) => m.providerId === providerId)?.providerName ??
		providerId;

	const seriesEmphasis = (providerId: string) => {
		if (!selectedProviderId || selectedProviderId === providerId) {
			return { strokeWidth: 2, opacity: 1 };
		}
		return { strokeWidth: 1.5, opacity: 0.35 };
	};

	return (
		<div className="mx-auto flex w-full max-w-[1920px] flex-col gap-6 px-4 py-8 md:px-8">
			<header className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
				<div>
					<h1 className="text-3xl font-semibold tracking-tight">
						Routing Analytics
					</h1>
					<p className="mt-1 max-w-3xl text-sm text-muted-foreground">
						Why the gateway elects a specific provider mapping for a routed
						model id: hourly-averaged routing inputs (uptime, latency,
						throughput), static factors (price, priority, cache support), and
						the resulting weighted score per mapping. Live routing uses the same
						formula over a tier-weighted 60-minute window; hourly buckets are
						shown here to smooth out fluctuations.
					</p>
				</div>
				<div className="flex flex-wrap items-center gap-3">
					<ModelMappingSelector
						models={selectableModels}
						providers={providers}
						value={selectorValue}
						onValueChange={handleMappingChange}
						placeholder="Select a mapping…"
					/>
					<div className="flex items-center gap-1 rounded-md border border-border/60 bg-background p-1">
						{WINDOW_OPTIONS.map((option) => (
							<Button
								key={option.value}
								variant={window === option.value ? "default" : "ghost"}
								size="sm"
								className="h-7 px-3 text-xs"
								onClick={() => updateParams({ window: option.value })}
							>
								{option.label}
							</Button>
						))}
					</div>
				</div>
			</header>

			{!modelId ? (
				<EmptyState>
					Select a provider mapping to inspect how its model is routed.
				</EmptyState>
			) : isError ? (
				<EmptyState>Failed to load routing analytics for {modelId}.</EmptyState>
			) : isLoading || !data ? (
				<EmptyState>Loading…</EmptyState>
			) : (
				<>
					<section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
						<StatCard
							label="Requests"
							value={numberFormatter.format(totalRequests)}
							hint="served, from the mapping rollup"
						/>
						<StatCard
							label="Elected mapping"
							value={
								electedProviderId ? (
									<span className="text-xl">
										{providerName(electedProviderId)}
									</span>
								) : (
									"—"
								)
							}
							hint="lowest score, not the busiest"
						/>
						<StatCard
							label="Routable mappings"
							value={`${routableCount} / ${data.mappings.length}`}
						/>
						<StatCard
							label="Selected mapping"
							value={
								selectedSummary ? (
									<span className="text-xl">
										#{selectedRank + 1} of {scoredSummary.length}
										<span className="ml-2 text-sm font-normal text-muted-foreground">
											score {selectedSummary.score?.toFixed(3)}
										</span>
									</span>
								) : (
									<span className="text-xl text-muted-foreground">
										{selectedProviderId ? "not scored" : "none selected"}
									</span>
								)
							}
						/>
						<StatCard
							label="Score-decided"
							value={
								<span>
									{formatPercent(
										data.elections.scoredCount,
										data.elections.requestCount,
									)}
									<span className="ml-2 text-sm font-normal text-muted-foreground">
										of {numberFormatter.format(data.elections.requestCount)}{" "}
										routed
									</span>
								</span>
							}
							hint={telemetryCoverageHint}
						/>
						<StatCard
							label="Avg. candidates"
							value={
								data.elections.averageCandidateCount !== null
									? data.elections.averageCandidateCount.toFixed(2)
									: "—"
							}
						/>
						<StatCard
							label="Tiered requests"
							value={
								<span>
									{formatPercent(
										data.serviceTier.explicit + data.serviceTier.implicit,
										data.serviceTier.requestCount,
									)}
									<span className="ml-2 text-sm font-normal text-muted-foreground">
										{numberFormatter.format(data.serviceTier.implicit)} implicit
									</span>
								</span>
							}
						/>
						<StatCard
							label="Excluded from elections"
							value={
								data.exclusions.length > 0 ? (
									<span>
										{numberFormatter.format(
											data.exclusions.reduce(
												(sum, entry) => sum + entry.excludedCount,
												0,
											),
										)}
										<span className="ml-2 text-sm font-normal text-muted-foreground">
											{exclusionReasonLabel(data.exclusions[0].reason)} leads
										</span>
									</span>
								) : (
									<span className="text-muted-foreground">none</span>
								)
							}
							hint="mapping drops, not requests"
						/>
					</section>

					<Card>
						<CardHeader className="border-b p-4 sm:p-6">
							<CardTitle>How routing was decided</CardTitle>
							<CardDescription className="max-w-3xl">
								Which mechanism picked the provider for each request. Only{" "}
								<strong>{electionKindLabel("scored")}</strong> means the
								weighted score below decided the outcome — every other path
								either bypasses the score (a pinned{" "}
								<span className="font-mono">provider/model</span> string, a
								candidate set narrowed to one) or overrides it (sticky sessions,
								fallbacks, exploration). A mapping with the best score can still
								see almost no traffic if this bar is mostly not green.
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-4 p-4 sm:p-6">
							<ProportionBar
								segments={data.elections.byKind.map((entry) => ({
									key: entry.kind,
									label: electionKindLabel(entry.kind),
									value: entry.requestCount,
									color: electionKindColor(entry.kind),
								}))}
								total={data.elections.requestCount}
							/>
							{data.elections.byReason.length > 0 ? (
								<div className="flex flex-wrap gap-1.5">
									{data.elections.byReason.map((entry) => (
										<Badge
											key={entry.selectionReason}
											variant="outline"
											className="text-xs font-normal"
										>
											{ROUTING_SELECTION_REASON_LABELS[
												entry.selectionReason as RoutingSelectionReason
											] ?? entry.selectionReason}
											<span className="ml-1.5 font-mono text-muted-foreground">
												{formatPercent(
													entry.requestCount,
													data.elections.requestCount,
												)}
											</span>
										</Badge>
									))}
								</div>
							) : null}
						</CardContent>
					</Card>

					<Card>
						<CardHeader className="border-b p-4 sm:p-6">
							<CardTitle>Service tier coverage</CardTitle>
							<CardDescription className="max-w-3xl">
								A premium tier narrows routing to mappings that support it,
								before any score is computed. <strong>Implicit</strong> is the
								coding-plan default applied on the organization&apos;s behalf —
								the client never asked for a tier, but the narrowing happens
								anyway, which is why it is counted separately.{" "}
								<strong>Unconfirmed</strong> means the response never confirmed
								the tier: either the provider downgraded to standard or it
								reports no tier at all. Both are billed at the standard rate.
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-4 p-4 sm:p-6">
							<ProportionBar
								segments={[
									{
										key: "explicit",
										label: "Explicitly requested",
										value: data.serviceTier.explicit,
										color: "hsl(221 83% 53%)",
									},
									{
										key: "implicit",
										label: "Implicit (coding-plan default)",
										value: data.serviceTier.implicit,
										color: "hsl(32 95% 44%)",
									},
									{
										key: "none",
										label: "No tier (standard)",
										value: untieredRequests,
										color: "hsl(215 16% 47%)",
									},
								]}
								total={data.serviceTier.requestCount}
							/>
							{data.serviceTier.explicit + data.serviceTier.implicit > 0 ? (
								<div className="flex flex-wrap gap-x-6 gap-y-2 text-xs">
									<span>
										Confirmed at a premium tier{" "}
										<span className="font-mono">
											{numberFormatter.format(data.serviceTier.served)}
										</span>
									</span>
									<span>
										Sent at a tier, unconfirmed{" "}
										<span className="font-mono">
											{numberFormatter.format(data.serviceTier.unconfirmed)}
										</span>
									</span>
								</div>
							) : null}
						</CardContent>
					</Card>

					<Card>
						<CardHeader className="flex flex-col items-stretch space-y-2 border-b p-4 sm:flex-row sm:items-start sm:justify-between sm:space-y-0 sm:p-6">
							<div>
								<CardTitle>
									Mappings for{" "}
									<span className="font-mono">{data.model.id}</span>
								</CardTitle>
								<CardDescription className="max-w-3xl">
									Window averages with every factor the router considers. Sorted
									by score (lowest routes first). Prices include platform-wide
									discounts; an organization-specific discount can lower its own
									price further and shift that organization&apos;s election.
								</CardDescription>
							</div>
							<div className="flex flex-wrap gap-1.5 sm:justify-end">
								{(
									[
										["Price", data.config.effectiveWeights.price],
										["Uptime", data.config.effectiveWeights.uptime],
										["Throughput", data.config.effectiveWeights.throughput],
										["Latency", data.config.effectiveWeights.latency],
										["Cache", data.config.effectiveWeights.cache],
									] as const
								).map(([label, weight]) => (
									<Badge key={label} variant="secondary" className="text-xs">
										{label}:{" "}
										{(
											(weight / data.config.effectiveWeights.total) *
											100
										).toFixed(1)}
										%
									</Badge>
								))}
							</div>
						</CardHeader>
						<CardContent className="p-0">
							<div className="overflow-x-auto">
								<Table>
									<TableHeader>
										<TableRow className="[&>th]:whitespace-nowrap">
											<TableHead>Provider</TableHead>
											<TableHead>Status</TableHead>
											<TableHead className="text-right">Price</TableHead>
											<TableHead className="text-right">Priority</TableHead>
											<TableHead className="text-center">Cache</TableHead>
											<TableHead className="text-right">Uptime</TableHead>
											<TableHead className="text-right">TTFT</TableHead>
											<TableHead className="text-right">Throughput</TableHead>
											<TableHead className="text-right">Requests</TableHead>
											<TableHead className="text-right">Share</TableHead>
											<TableHead className="text-right">Eligible</TableHead>
											<TableHead className="text-right">Score</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{sortedSummary.map((summary) => {
											const mapping = data.mappings.find(
												(m) => m.providerId === summary.providerId,
											)!;
											const eligibility = data.eligibility.find(
												(e) => e.providerId === summary.providerId,
											);
											return (
												<TableRow
													key={summary.providerId}
													className={cn(
														selectedProviderId === summary.providerId &&
															"bg-muted/60",
													)}
												>
													<TableCell>
														<div className="flex items-center gap-2">
															<span
																className="h-2.5 w-2.5 shrink-0 rounded-full"
																style={{
																	backgroundColor:
																		chartConfig[summary.providerId]?.color,
																}}
															/>
															<span className="font-medium">
																{mapping.providerName}
															</span>
															<span className="font-mono text-xs text-muted-foreground">
																{mapping.providerId}
															</span>
														</div>
													</TableCell>
													<TableCell>
														{mapping.routable ? (
															<div className="flex flex-wrap gap-1">
																<Badge variant="outline" className="text-xs">
																	{mapping.stability}
																</Badge>
																{isDeactivationScheduledSoon(mapping) ? (
																	<Badge
																		variant="outline"
																		className="text-xs border-amber-500 text-amber-600 dark:text-amber-400"
																		title="Scheduled deactivation. The mapping still routes normally until this date."
																	>
																		deactivates{" "}
																		{formatDeactivationDate(
																			mapping.deactivatedAt,
																		)}
																	</Badge>
																) : null}
															</div>
														) : (
															<div className="flex flex-wrap gap-1">
																{mapping.excludedReasons.map((reason) => (
																	<Badge
																		key={reason}
																		variant="destructive"
																		className="text-xs"
																	>
																		{reason}
																	</Badge>
																))}
															</div>
														)}
													</TableCell>
													<TableCell className="text-right font-mono text-xs">
														{formatSelectionPrice(
															mapping.price,
															data.model.isImageModel,
														)}
														{mapping.discount > 0 ? (
															<div className="text-[11px] text-muted-foreground">
																<span className="line-through">
																	{formatSelectionPrice(
																		mapping.listPrice,
																		data.model.isImageModel,
																	)}
																</span>{" "}
																−{(mapping.discount * 100).toFixed(0)}%
															</div>
														) : null}
													</TableCell>
													<TableCell className="text-right font-mono text-xs">
														{mapping.priority}
													</TableCell>
													<TableCell className="text-center">
														{mapping.cacheSupported ? "✓" : "—"}
													</TableCell>
													<TableCell className="text-right font-mono text-xs">
														{summary.uptime !== null
															? `${summary.uptime.toFixed(1)}%`
															: "—"}
													</TableCell>
													<TableCell className="text-right font-mono text-xs">
														{summary.latency !== null
															? `${Math.round(summary.latency)} ms`
															: "—"}
													</TableCell>
													<TableCell className="text-right font-mono text-xs">
														{summary.throughput !== null
															? `${summary.throughput.toFixed(1)} tok/s`
															: "—"}
													</TableCell>
													<TableCell className="text-right font-mono text-xs">
														{numberFormatter.format(summary.requestCount)}
													</TableCell>
													<TableCell className="text-right font-mono text-xs">
														{totalRequests > 0
															? `${((summary.requestCount / totalRequests) * 100).toFixed(1)}%`
															: "—"}
													</TableCell>
													{/* Eligibility and its dominant cause share one column:
													    as two they pushed Score past the visible width. */}
													<TableCell className="text-right font-mono text-xs">
														{eligibility?.exclusionRate !== null &&
														eligibility?.exclusionRate !== undefined ? (
															<>
																<span
																	className={cn(
																		eligibility.exclusionRate > 0.5 &&
																			"font-semibold text-amber-600",
																	)}
																>
																	{(
																		(1 - eligibility.exclusionRate) *
																		100
																	).toFixed(0)}
																	%
																</span>
																{eligibility.topReason ? (
																	<div
																		className="font-sans text-[11px] text-muted-foreground"
																		title={eligibility.exclusions
																			.map(
																				(entry) =>
																					`${exclusionReasonLabel(entry.reason)}: ${numberFormatter.format(entry.excludedCount)}`,
																			)
																			.join("\n")}
																	>
																		{exclusionReasonLabel(
																			eligibility.topReason,
																		)}
																		{eligibility.exclusions.length > 1
																			? ` +${eligibility.exclusions.length - 1}`
																			: ""}
																	</div>
																) : null}
															</>
														) : (
															"—"
														)}
													</TableCell>
													<TableCell className="text-right font-mono text-xs font-semibold">
														{summary.score !== null
															? summary.score.toFixed(3)
															: "—"}
													</TableCell>
												</TableRow>
											);
										})}
									</TableBody>
								</Table>
							</div>
							<p className="border-t p-4 text-xs text-muted-foreground sm:px-6">
								Score = weighted factor scores + priority penalty + exponential
								uptime penalty (below {data.config.thresholds.uptimePenalty}%
								uptime). Lowest score wins. Missing metrics fall back to{" "}
								{data.config.thresholds.defaultUptime}% uptime,{" "}
								{data.config.thresholds.defaultLatency} ms latency and{" "}
								{data.config.thresholds.defaultThroughput} tok/s.{" "}
								{Math.round(data.config.thresholds.explorationRate * 100)}% of
								requests are routed randomly for exploration.
							</p>
						</CardContent>
					</Card>

					<Card>
						<CardHeader className="flex flex-col items-stretch space-y-2 border-b p-4 sm:flex-row sm:items-center sm:justify-between sm:space-y-0 sm:p-6">
							<div>
								<CardTitle>{metricOption.label} over time</CardTitle>
								<CardDescription className="max-w-3xl">
									{metricOption.description}
								</CardDescription>
							</div>
							<div className="flex items-center gap-1 rounded-md border border-border/60 bg-background p-1">
								{METRIC_OPTIONS.map((option) => (
									<Button
										key={option.value}
										variant={metric === option.value ? "default" : "ghost"}
										size="sm"
										className="h-7 px-3 text-xs"
										onClick={() => updateParams({ metric: option.value })}
									>
										{option.label}
									</Button>
								))}
							</div>
						</CardHeader>
						<CardContent className="px-2 pb-4 sm:p-6">
							<ChartContainer
								config={chartConfig}
								className="aspect-auto h-[320px] w-full"
							>
								<LineChart
									data={metricChartData}
									margin={{ left: 12, right: 12 }}
								>
									<CartesianGrid vertical={false} strokeDasharray="3 3" />
									<XAxis
										dataKey="hour"
										tickLine={false}
										axisLine={false}
										tickMargin={8}
										minTickGap={48}
										tickFormatter={formatAxisHour}
									/>
									<YAxis
										tickLine={false}
										axisLine={false}
										width={70}
										domain={metric === "uptime" ? [0, 100] : ["auto", "auto"]}
										tickFormatter={(value: number) =>
											formatMetricValue(metric, value)
										}
									/>
									<ChartTooltip
										content={
											<ChartTooltipContent
												className="w-[220px]"
												labelFormatter={formatTooltipHour}
												formatter={(value, name, item) => (
													<div className="flex w-full items-center gap-2">
														<span
															className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
															style={{ backgroundColor: item.color }}
														/>
														<span className="flex-1 text-muted-foreground">
															{chartConfig[name as string]?.label ?? name}
														</span>
														<span className="font-mono font-medium tabular-nums text-foreground">
															{formatMetricValue(metric, Number(value))}
														</span>
													</div>
												)}
											/>
										}
									/>
									<ChartLegend content={<ChartLegendContent />} />
									{chartedProviders.map((mapping) => {
										const emphasis = seriesEmphasis(mapping.providerId);
										return (
											<Line
												key={mapping.providerId}
												dataKey={mapping.providerId}
												type="monotone"
												stroke={`var(--color-${mapping.providerId})`}
												strokeWidth={emphasis.strokeWidth}
												strokeOpacity={emphasis.opacity}
												dot={false}
												connectNulls={false}
											/>
										);
									})}
								</LineChart>
							</ChartContainer>
							{metric === "score" ? (
								<p className="mt-2 px-2 text-xs text-muted-foreground sm:px-0">
									Lower is better — the mapping with the lowest score wins the
									election. Hours without traffic are scored with the default
									metric fallbacks.
								</p>
							) : null}
						</CardContent>
					</Card>

					<Card>
						<CardHeader className="border-b p-4 sm:p-6">
							<CardTitle>Requests per hour</CardTitle>
							<CardDescription className="max-w-3xl">
								Where traffic actually went — the outcome of the elections above
								(including pinned providers, sticky sessions, fallbacks and
								exploration).
							</CardDescription>
						</CardHeader>
						<CardContent className="px-2 pb-4 sm:p-6">
							<ChartContainer
								config={chartConfig}
								className="aspect-auto h-[260px] w-full"
							>
								<BarChart
									data={trafficChartData}
									margin={{ left: 12, right: 12 }}
								>
									<CartesianGrid vertical={false} strokeDasharray="3 3" />
									<XAxis
										dataKey="hour"
										tickLine={false}
										axisLine={false}
										tickMargin={8}
										minTickGap={48}
										tickFormatter={formatAxisHour}
									/>
									<YAxis tickLine={false} axisLine={false} width={50} />
									<ChartTooltip
										content={
											<ChartTooltipContent
												className="w-[220px]"
												sortByValue
												labelFormatter={formatTooltipHour}
											/>
										}
									/>
									<ChartLegend content={<ChartLegendContent />} />
									{chartedProviders.map((mapping) => (
										<Bar
											key={mapping.providerId}
											dataKey={mapping.providerId}
											stackId="requests"
											fill={`var(--color-${mapping.providerId})`}
											fillOpacity={seriesEmphasis(mapping.providerId).opacity}
										/>
									))}
								</BarChart>
							</ChartContainer>
						</CardContent>
					</Card>

					<Card>
						<CardHeader className="border-b p-4 sm:p-6">
							<CardTitle>Election path per hour</CardTitle>
							<CardDescription className="max-w-3xl">
								The same split as the bar above, over time. A collapse in the
								score-decided share is what to look for when a mapping stops
								receiving traffic without its score changing.
							</CardDescription>
						</CardHeader>
						<CardContent className="px-2 pb-4 sm:p-6">
							<ChartContainer
								config={electionChartConfig}
								className="aspect-auto h-[260px] w-full"
							>
								<BarChart
									data={electionChartData}
									margin={{ left: 12, right: 12 }}
								>
									<CartesianGrid vertical={false} />
									<XAxis
										dataKey="hour"
										tickLine={false}
										axisLine={false}
										tickMargin={8}
										minTickGap={48}
										tickFormatter={formatAxisHour}
									/>
									<YAxis tickLine={false} axisLine={false} width={50} />
									<ChartTooltip
										content={
											<ChartTooltipContent labelFormatter={formatTooltipHour} />
										}
									/>
									<ChartLegend content={<ChartLegendContent />} />
									{electionKinds.map((kind) => (
										<Bar
											key={kind}
											dataKey={kind}
											stackId="elections"
											fill={`var(--color-${kind})`}
										/>
									))}
								</BarChart>
							</ChartContainer>
						</CardContent>
					</Card>

					<Card>
						<CardHeader className="border-b p-4 sm:p-6">
							<CardTitle>Why mappings were excluded</CardTitle>
							<CardDescription className="max-w-3xl">
								Every constraint that dropped a mapping from an election in this
								window, across all providers. One request can exclude a mapping
								for several reasons, so these do not sum to a request count —
								read them as relative pressure on routing freedom.
							</CardDescription>
						</CardHeader>
						<CardContent className="p-4 sm:p-6">
							{data.exclusions.length === 0 ? (
								<p className="text-sm text-muted-foreground">
									No mapping was filtered out of an election in this window.
								</p>
							) : (
								<div className="space-y-2">
									{data.exclusions.map((entry) => (
										<div
											key={entry.reason}
											className="flex items-center gap-3 text-xs"
										>
											<span className="w-44 shrink-0 truncate">
												{exclusionReasonLabel(entry.reason)}
											</span>
											<div className="h-3 flex-1 overflow-hidden rounded-full bg-muted">
												<div
													className="h-full rounded-full bg-amber-500"
													style={{
														width: `${(entry.excludedCount / maxExclusionCount) * 100}%`,
													}}
												/>
											</div>
											<span className="w-20 shrink-0 text-right font-mono text-muted-foreground">
												{numberFormatter.format(entry.excludedCount)}
											</span>
										</div>
									))}
								</div>
							)}
						</CardContent>
					</Card>

					<Card>
						<CardHeader className="border-b p-4 sm:p-6">
							<CardTitle>Score composition (window average)</CardTitle>
							<CardDescription className="max-w-3xl">
								How each factor contributes to the final score. Factor
								contributions are the weighted ratio against the best mapping (0
								= best); penalties are added on top.
							</CardDescription>
						</CardHeader>
						<CardContent className="p-0">
							<div className="overflow-x-auto">
								<Table>
									<TableHeader>
										<TableRow className="[&>th]:whitespace-nowrap">
											<TableHead>Provider</TableHead>
											<TableHead className="text-right">Price</TableHead>
											<TableHead className="text-right">Uptime</TableHead>
											<TableHead className="text-right">Throughput</TableHead>
											<TableHead className="text-right">Latency</TableHead>
											<TableHead className="text-right">Cache</TableHead>
											<TableHead className="text-right">
												Priority penalty
											</TableHead>
											<TableHead className="text-right">
												Uptime penalty
											</TableHead>
											<TableHead className="text-right">= Score</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{sortedSummary
											.filter((summary) => summary.breakdown !== null)
											.map((summary) => {
												const breakdown = summary.breakdown!;
												const mapping = data.mappings.find(
													(m) => m.providerId === summary.providerId,
												)!;
												return (
													<TableRow
														key={summary.providerId}
														className={cn(
															selectedProviderId === summary.providerId &&
																"bg-muted/60",
														)}
													>
														<TableCell>
															<div className="flex items-center gap-2">
																<span
																	className="h-2.5 w-2.5 shrink-0 rounded-full"
																	style={{
																		backgroundColor:
																			chartConfig[summary.providerId]?.color,
																	}}
																/>
																{mapping.providerName}
															</div>
														</TableCell>
														<TableCell className="text-right font-mono text-xs">
															{formatContribution(breakdown.priceContribution)}
														</TableCell>
														<TableCell className="text-right font-mono text-xs">
															{formatContribution(breakdown.uptimeContribution)}
														</TableCell>
														<TableCell className="text-right font-mono text-xs">
															{formatContribution(
																breakdown.throughputContribution,
															)}
														</TableCell>
														<TableCell className="text-right font-mono text-xs">
															{formatContribution(
																breakdown.latencyContribution,
															)}
														</TableCell>
														<TableCell className="text-right font-mono text-xs">
															{formatContribution(breakdown.cacheContribution)}
														</TableCell>
														<TableCell className="text-right font-mono text-xs">
															{formatContribution(breakdown.priorityPenalty)}
														</TableCell>
														<TableCell className="text-right font-mono text-xs">
															{formatContribution(breakdown.uptimePenalty)}
														</TableCell>
														<TableCell className="text-right font-mono text-xs font-semibold">
															{summary.score !== null
																? summary.score.toFixed(3)
																: "—"}
														</TableCell>
													</TableRow>
												);
											})}
									</TableBody>
								</Table>
							</div>
						</CardContent>
					</Card>
				</>
			)}
		</div>
	);
}
