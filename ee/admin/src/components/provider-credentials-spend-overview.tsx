"use client";

import { format } from "date-fns";
import { useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";

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
import { useApi } from "@/lib/fetch-client";
import { cn } from "@/lib/utils";

import { getProviderIcon } from "@llmgateway/shared";

import type { ChartConfig } from "@/components/ui/chart";

type SpendWindow = "1d" | "7d" | "30d" | "90d";
type Metric = "cost" | "totalTokens" | "requestCount";

const WINDOWS: { key: SpendWindow; label: string }[] = [
	{ key: "1d", label: "24h" },
	{ key: "7d", label: "7d" },
	{ key: "30d", label: "30d" },
	{ key: "90d", label: "90d" },
];

const METRICS: { key: Metric; label: string }[] = [
	{ key: "cost", label: "Cost" },
	{ key: "totalTokens", label: "Tokens" },
	{ key: "requestCount", label: "Requests" },
];

/**
 * Categorical palette in fixed slot order, with separate steps for the dark
 * surface. Colors are assigned by a credential's spend rank within its
 * provider and never cycled: past eight series the remainder folds into
 * "Other" instead of minting a ninth hue nobody could tell apart.
 */
const SERIES_THEMES: { light: string; dark: string }[] = [
	{ light: "#2a78d6", dark: "#3987e5" },
	{ light: "#eb6834", dark: "#d95926" },
	{ light: "#1baf7a", dark: "#199e70" },
	{ light: "#eda100", dark: "#c98500" },
	{ light: "#e87ba4", dark: "#d55181" },
	{ light: "#008300", dark: "#008300" },
	{ light: "#4a3aa7", dark: "#9085e9" },
	{ light: "#e34948", dark: "#e66767" },
];

const OTHER_SERIES_THEME = { light: "#8a8984", dark: "#8a8984" };
const OTHER_SERIES_KEY = "other";

const currencyFormatter = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
	maximumFractionDigits: 4,
});

const compactFormatter = new Intl.NumberFormat("en-US", {
	notation: "compact",
	maximumFractionDigits: 1,
});

/** Whole-window totals read as money amounts, not per-bucket fractions. */
const totalCurrencyFormatter = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
	maximumFractionDigits: 2,
});

interface OverviewKey {
	id: string;
	provider: string;
	variant: "default" | "enterprise" | "plans";
	region: string | null;
	comment: string | null;
	maskedToken: string;
	status: string | null;
	usage: string;
	usageLimit: string | null;
	totalCost: number;
	totalRequests: number;
	totalTokens: string;
}

interface OverviewPoint {
	timestamp: string;
	providerKeyId: string;
	cost: number;
	requestCount: number;
	totalTokens: string;
}

/**
 * What tells this credential apart from its siblings: the operator's note when
 * there is one, the masked token otherwise, then any scope that differs from
 * the default. Matches how the rows below the chart identify themselves.
 */
function credentialLabel(key: OverviewKey): string {
	const parts = [key.comment || key.maskedToken];
	if (key.variant !== "default") {
		parts.push(key.variant);
	}
	if (key.region) {
		parts.push(key.region);
	}
	if (key.status === "deleted") {
		parts.push("deleted");
	}
	return parts.join(" · ");
}

/** Recharts config keys become CSS custom property names; keep them plain. */
function seriesKey(id: string): string {
	return `k_${id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

function metricValue(point: OverviewPoint, metric: Metric): number {
	if (metric === "totalTokens") {
		return Number(point.totalTokens);
	}
	return point[metric];
}

function formatMetric(value: number, metric: Metric): string {
	return metric === "cost"
		? currencyFormatter.format(value)
		: value.toLocaleString();
}

interface ProviderSeries {
	provider: string;
	config: ChartConfig;
	/** Series keys in stacking order (largest spender first). */
	seriesKeys: string[];
	data: Record<string, number | string>[];
	/** Whether any bucket in the window carried traffic for this provider. */
	hasTraffic: boolean;
	windowCost: number;
	windowRequests: number;
	windowTokens: number;
}

/**
 * Pivots the flat (bucket, credential) rows into one stacked series set per
 * provider. Every series is zero-filled across the window's full bucket grid —
 * a stacked area with holes would silently reassign the missing band to the
 * series below it, and a chart built only from buckets that saw traffic would
 * quietly shrink its axis to the busy days instead of the selected window.
 */
function buildProviderSeries(
	keys: OverviewKey[],
	points: OverviewPoint[],
	buckets: string[],
	metric: Metric,
): ProviderSeries[] {
	const pointsByKey = new Map<string, OverviewPoint[]>();
	for (const point of points) {
		pointsByKey.set(point.providerKeyId, [
			...(pointsByKey.get(point.providerKeyId) ?? []),
			point,
		]);
	}

	const providers: string[] = [];
	const keysByProvider = new Map<string, OverviewKey[]>();
	for (const key of keys) {
		if (!keysByProvider.has(key.provider)) {
			providers.push(key.provider);
			keysByProvider.set(key.provider, []);
		}
		keysByProvider.get(key.provider)!.push(key);
	}

	return providers.map((provider) => {
		const providerKeys = keysByProvider.get(provider)!;
		// Ranked by window cost, not the active metric, so switching the metric
		// tab never repaints a credential with a different color.
		const ranked = [...providerKeys].sort((a, b) => b.totalCost - a.totalCost);
		const visible =
			ranked.length > SERIES_THEMES.length
				? ranked.slice(0, SERIES_THEMES.length - 1)
				: ranked;
		const folded = ranked.slice(visible.length);

		const config: ChartConfig = {};
		const seriesKeys: string[] = [];
		visible.forEach((key, index) => {
			const sk = seriesKey(key.id);
			seriesKeys.push(sk);
			config[sk] = {
				label: credentialLabel(key),
				theme: SERIES_THEMES[index],
			};
		});
		if (folded.length > 0) {
			seriesKeys.push(OTHER_SERIES_KEY);
			config[OTHER_SERIES_KEY] = {
				label: `Other (${folded.length})`,
				theme: OTHER_SERIES_THEME,
			};
		}

		const foldedIds = new Set(folded.map((key) => key.id));
		const rows = new Map<string, Record<string, number | string>>();
		// The server's grid spans the whole window; the provider's own buckets are
		// unioned in so nothing is dropped if a rollup row falls just outside it.
		const timestamps = new Set<string>(buckets);
		let hasTraffic = false;
		for (const key of providerKeys) {
			for (const point of pointsByKey.get(key.id) ?? []) {
				timestamps.add(point.timestamp);
				hasTraffic = true;
			}
		}
		for (const timestamp of Array.from(timestamps).sort()) {
			const row: Record<string, number | string> = { timestamp };
			for (const sk of seriesKeys) {
				row[sk] = 0;
			}
			rows.set(timestamp, row);
		}
		for (const key of providerKeys) {
			const sk = foldedIds.has(key.id) ? OTHER_SERIES_KEY : seriesKey(key.id);
			for (const point of pointsByKey.get(key.id) ?? []) {
				const row = rows.get(point.timestamp)!;
				row[sk] = Number(row[sk]) + metricValue(point, metric);
			}
		}

		return {
			provider,
			config,
			seriesKeys,
			data: Array.from(rows.values()),
			hasTraffic,
			windowCost: providerKeys.reduce((sum, key) => sum + key.totalCost, 0),
			windowRequests: providerKeys.reduce(
				(sum, key) => sum + key.totalRequests,
				0,
			),
			windowTokens: providerKeys.reduce(
				(sum, key) => sum + Number(key.totalTokens),
				0,
			),
		};
	});
}

function ProviderSpendChart({
	series,
	providerName,
	metric,
	bucketIsHour,
}: {
	series: ProviderSeries;
	providerName: string;
	metric: Metric;
	bucketIsHour: boolean;
}) {
	const Icon = getProviderIcon(series.provider);

	return (
		<div className="rounded-lg border border-border/60 p-4">
			<div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
				<div className="flex items-center gap-2">
					{Icon ? <Icon className="h-4 w-4 shrink-0" /> : null}
					<span className="font-medium">{providerName}</span>
				</div>
				<span className="text-xs tabular-nums text-muted-foreground">
					{totalCurrencyFormatter.format(series.windowCost)} ·{" "}
					{series.windowRequests.toLocaleString()} requests ·{" "}
					{compactFormatter.format(series.windowTokens)} tokens
				</span>
			</div>
			{!series.hasTraffic ? (
				<div className="flex h-56 items-center justify-center text-sm text-muted-foreground">
					No attributed spend in this window.
				</div>
			) : (
				<ChartContainer config={series.config} className="h-56 w-full">
					<AreaChart
						data={series.data}
						margin={{ left: 0, right: 8, top: 4, bottom: 0 }}
					>
						<CartesianGrid vertical={false} strokeDasharray="3 3" />
						<XAxis
							dataKey="timestamp"
							tickLine={false}
							axisLine={false}
							tickMargin={8}
							minTickGap={40}
							tickFormatter={(value: string) =>
								format(new Date(value), bucketIsHour ? "HH:mm" : "MMM d")
							}
						/>
						<YAxis
							tickLine={false}
							axisLine={false}
							tickMargin={4}
							width={64}
							tickFormatter={(value: number) =>
								metric === "cost"
									? currencyFormatter.format(value)
									: compactFormatter.format(value)
							}
						/>
						<ChartTooltip
							content={(props) => {
								const sortedPayload = [...(props.payload ?? [])]
									.filter((item) => Number(item.value ?? 0) > 0)
									.sort((a, b) => Number(b.value ?? 0) - Number(a.value ?? 0));
								return (
									<ChartTooltipContent
										active={props.active}
										label={props.label}
										payload={sortedPayload}
										labelFormatter={(value) =>
											format(
												new Date(value as string),
												bucketIsHour ? "MMM d, HH:mm" : "MMM d, yyyy",
											)
										}
										formatter={(value, name, item) => {
											const label =
												series.config[name as string]?.label ?? String(name);
											return (
												<span className="flex w-full items-center gap-1.5">
													<span
														className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
														style={{ backgroundColor: item.color }}
													/>
													<span className="text-muted-foreground">{label}</span>
													<span className="ml-auto font-mono font-medium tabular-nums">
														{formatMetric(Number(value), metric)}
													</span>
												</span>
											);
										}}
									/>
								);
							}}
						/>
						{series.seriesKeys.map((sk) => (
							<Area
								key={sk}
								dataKey={sk}
								type="monotone"
								stackId="1"
								stroke={`var(--color-${sk})`}
								fill={`var(--color-${sk})`}
								fillOpacity={0.5}
								strokeWidth={1}
							/>
						))}
						<ChartLegend content={<ChartLegendContent />} />
					</AreaChart>
				</ChartContainer>
			)}
		</div>
	);
}

/**
 * Stacked spend-over-time charts for the managed credential fleet, one chart
 * per provider with one band per credential — the "which key is actually
 * burning the money" view the per-row dialog cannot give across keys.
 */
export function ProviderCredentialsSpendOverview({
	providerFilter,
	providerNames,
}: {
	/** Provider id to narrow to, or null for every provider. */
	providerFilter: string | null;
	/** Display names from the catalog, keyed by provider id. */
	providerNames: Record<string, string>;
}) {
	const [window, setWindow] = useState<SpendWindow>("7d");
	const [metric, setMetric] = useState<Metric>("cost");
	const $api = useApi();

	const { data, isLoading } = $api.useQuery(
		"get",
		"/admin/provider-credentials/spend",
		{ params: { query: { window } } },
	);

	const providerSeries = useMemo(() => {
		if (!data) {
			return [];
		}
		const keys = (data.keys as OverviewKey[]).filter(
			(key) => providerFilter === null || key.provider === providerFilter,
		);
		return buildProviderSeries(keys, data.data, data.buckets, metric);
	}, [data, providerFilter, metric]);

	const bucketIsHour = data?.bucket === "hour";

	return (
		<Card>
			<CardHeader className="pb-4">
				<div className="flex flex-wrap items-start justify-between gap-3">
					<div>
						<CardTitle className="text-base">Spend by credential</CardTitle>
						<CardDescription className="mt-1 max-w-2xl">
							Upstream cost and tokens attributed to each managed credential.
							Env-var keys are not attributed individually, and cached responses
							are recorded at zero cost.
						</CardDescription>
					</div>
					<div className="flex flex-wrap items-center gap-3">
						<div className="flex items-center gap-1">
							{METRICS.map((entry) => (
								<button
									key={entry.key}
									type="button"
									className={cn(
										"rounded-md px-3 py-1 text-xs font-medium transition-colors",
										metric === entry.key
											? "bg-primary text-primary-foreground"
											: "text-muted-foreground hover:text-foreground",
									)}
									onClick={() => setMetric(entry.key)}
								>
									{entry.label}
								</button>
							))}
						</div>
						<div className="flex items-center gap-1">
							{WINDOWS.map((entry) => (
								<Button
									key={entry.key}
									variant={window === entry.key ? "secondary" : "ghost"}
									size="sm"
									onClick={() => setWindow(entry.key)}
								>
									{entry.label}
								</Button>
							))}
						</div>
					</div>
				</div>
			</CardHeader>
			<CardContent>
				{isLoading ? (
					<div className="h-56 animate-pulse rounded-md bg-muted" />
				) : providerSeries.length === 0 ? (
					<p className="py-10 text-center text-sm text-muted-foreground">
						No managed credentials to chart yet.
					</p>
				) : (
					<div className="grid gap-4 xl:grid-cols-2 2xl:grid-cols-3">
						{providerSeries.map((series) => (
							<ProviderSpendChart
								key={series.provider}
								series={series}
								providerName={providerNames[series.provider] ?? series.provider}
								metric={metric}
								bucketIsHour={bucketIsHour}
							/>
						))}
					</div>
				)}
			</CardContent>
		</Card>
	);
}
