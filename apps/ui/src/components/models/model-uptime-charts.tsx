"use client";

import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Activity, AlertTriangle, Clock, Gauge, Zap } from "lucide-react";
import { useState } from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { Badge } from "@/lib/components/badge";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";
import {
	ChartContainer,
	ChartTooltip,
	ChartTooltipContent,
	type ChartConfig,
} from "@/lib/components/chart";
import { useAppConfig } from "@/lib/config";
import { cn } from "@/lib/utils";

import { getProviderIcon } from "@llmgateway/shared/components";

type ActiveMetric = "requests" | "errors" | "latency" | "tokens";

interface UptimePoint {
	timestamp: string;
	logsCount: number;
	errorsCount: number;
	clientErrorsCount: number;
	gatewayErrorsCount: number;
	upstreamErrorsCount: number;
	cachedCount: number;
	avgTtft: number | null;
	avgDuration: number | null;
	totalTokens: number;
}

interface UptimeProvider {
	providerId: string;
	providerName: string;
	logsCount: number;
	errorsCount: number;
	upstreamErrorsCount: number;
	uptime: number | null;
	avgTtft: number | null;
	avgDuration: number | null;
	tokensPerSecond: number | null;
	points: UptimePoint[];
}

interface UptimeResponse {
	modelId: string;
	windowMinutes: number;
	providers: UptimeProvider[];
}

const chartConfigs: Record<ActiveMetric, ChartConfig> = {
	requests: {
		logsCount: { label: "Requests", color: "hsl(221 83% 53%)" },
		cachedCount: { label: "Cached", color: "hsl(142 71% 45%)" },
	},
	errors: {
		clientErrorsCount: { label: "Client", color: "hsl(38 92% 50%)" },
		gatewayErrorsCount: { label: "Gateway", color: "hsl(262 83% 58%)" },
		upstreamErrorsCount: { label: "Upstream", color: "hsl(0 84% 60%)" },
	},
	latency: {
		avgTtft: { label: "Avg TTFT (ms)", color: "hsl(262 83% 58%)" },
		avgDuration: { label: "Avg Duration (ms)", color: "hsl(221 83% 53%)" },
	},
	tokens: {
		totalTokens: { label: "Tokens", color: "hsl(32 95% 44%)" },
	},
};

const metricTabs: { key: ActiveMetric; label: string }[] = [
	{ key: "requests", label: "Requests" },
	{ key: "errors", label: "Errors" },
	{ key: "latency", label: "Latency" },
	{ key: "tokens", label: "Tokens" },
];

function formatCompact(n: number): string {
	if (n >= 1_000_000_000) {
		return `${(n / 1_000_000_000).toFixed(1)}B`;
	}
	if (n >= 1_000_000) {
		return `${(n / 1_000_000).toFixed(1)}M`;
	}
	if (n >= 1_000) {
		return `${(n / 1_000).toFixed(1)}k`;
	}
	return n.toLocaleString();
}

function ProviderUptimeCard({ provider }: { provider: UptimeProvider }) {
	const [activeMetric, setActiveMetric] = useState<ActiveMetric>("requests");
	const ProviderIcon = getProviderIcon(provider.providerId);
	const config = chartConfigs[activeMetric];
	const dataKeys = Object.keys(config);

	const errorRate =
		provider.logsCount > 0
			? Math.round((provider.errorsCount / provider.logsCount) * 1000) / 10
			: 0;

	const uptimeColor =
		provider.uptime === null
			? "text-muted-foreground"
			: provider.uptime >= 99.5
				? "text-green-600 dark:text-green-500"
				: provider.uptime >= 95
					? "text-yellow-600 dark:text-yellow-500"
					: "text-red-600 dark:text-red-500";

	return (
		<Card>
			<CardHeader className="space-y-4 pb-2">
				<div className="flex flex-wrap items-start justify-between gap-3">
					<div className="flex items-center gap-3">
						<div className="rounded-md border border-border/60 bg-muted/40 p-2">
							{ProviderIcon ? (
								<ProviderIcon className="h-5 w-5 shrink-0 dark:text-white" />
							) : (
								<Activity className="h-5 w-5 shrink-0" />
							)}
						</div>
						<div>
							<CardTitle className="text-base flex items-center gap-2">
								{provider.providerName}
								<Badge variant="outline" className="text-[10px] uppercase">
									{provider.providerId}
								</Badge>
							</CardTitle>
							<CardDescription className="text-xs">
								Last 4 hours · {provider.points.length} data points
							</CardDescription>
						</div>
					</div>
					{provider.uptime !== null && (
						<div className="flex flex-col items-end">
							<span
								className={cn("text-2xl font-bold tabular-nums", uptimeColor)}
							>
								{provider.uptime.toFixed(1)}%
							</span>
							<span className="text-[10px] uppercase tracking-wide text-muted-foreground">
								Uptime
							</span>
						</div>
					)}
				</div>

				<div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
					<Stat
						icon={Activity}
						label="Requests"
						value={formatCompact(provider.logsCount)}
						sub={`${formatCompact(provider.errorsCount)} errors (${errorRate}%)`}
					/>
					<Stat
						icon={Clock}
						label="Avg TTFT"
						value={provider.avgTtft !== null ? `${provider.avgTtft}ms` : "—"}
						sub={
							provider.avgDuration !== null
								? `${provider.avgDuration}ms duration`
								: undefined
						}
					/>
					<Stat
						icon={Gauge}
						label="Throughput"
						value={
							provider.tokensPerSecond !== null
								? `${provider.tokensPerSecond.toLocaleString()} t/s`
								: "—"
						}
					/>
					<Stat
						icon={AlertTriangle}
						label="Upstream errors"
						value={formatCompact(provider.upstreamErrorsCount)}
						sub={
							provider.logsCount > 0
								? `${(
										Math.round(
											(provider.upstreamErrorsCount / provider.logsCount) *
												10000,
										) / 100
									).toFixed(2)}% rate`
								: undefined
						}
					/>
				</div>

				<div className="flex items-center gap-1 border-b pb-2">
					{metricTabs.map((tab) => (
						<button
							key={tab.key}
							className={cn(
								"rounded-md px-3 py-1 text-xs font-medium transition-colors",
								activeMetric === tab.key
									? "bg-primary text-primary-foreground"
									: "text-muted-foreground hover:text-foreground",
							)}
							onClick={() => setActiveMetric(tab.key)}
						>
							{tab.label}
						</button>
					))}
				</div>
			</CardHeader>
			<CardContent className="px-2 pb-4 sm:px-6">
				{provider.points.length === 0 ? (
					<div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">
						No traffic in the last 4 hours
					</div>
				) : (
					<ChartContainer
						config={config}
						className="aspect-auto h-[200px] w-full"
					>
						<AreaChart
							data={provider.points}
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
									format(new Date(value), "HH:mm")
								}
							/>
							<YAxis
								tickLine={false}
								axisLine={false}
								tickMargin={4}
								width={50}
								tickFormatter={(value: number) =>
									value >= 1000
										? `${(value / 1000).toFixed(1)}k`
										: String(value)
								}
							/>
							<ChartTooltip
								content={
									<ChartTooltipContent
										labelFormatter={(value: string) =>
											format(new Date(value), "MMM d, HH:mm")
										}
										formatter={(value, name) => {
											const label = config[name as string]?.label ?? name;
											const formatted =
												activeMetric === "latency"
													? `${Math.round(Number(value))}ms`
													: Number(value).toLocaleString();
											return (
												<span>
													{label}: <strong>{formatted}</strong>
												</span>
											);
										}}
									/>
								}
							/>
							{dataKeys.map((key, i) => (
								<Area
									key={key}
									dataKey={key}
									type="monotone"
									stroke={`var(--color-${key})`}
									fill={`var(--color-${key})`}
									fillOpacity={i === 0 ? 0.15 : 0.05}
									strokeWidth={2}
									isAnimationActive={false}
								/>
							))}
						</AreaChart>
					</ChartContainer>
				)}
			</CardContent>
		</Card>
	);
}

function Stat({
	icon: Icon,
	label,
	value,
	sub,
}: {
	icon: typeof Activity;
	label: string;
	value: string;
	sub?: string;
}) {
	return (
		<div className="space-y-0.5">
			<div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
				<Icon className="h-3 w-3" />
				{label}
			</div>
			<div className="text-base font-semibold tabular-nums">{value}</div>
			{sub && (
				<div className="text-[11px] text-muted-foreground tabular-nums">
					{sub}
				</div>
			)}
		</div>
	);
}

export function ModelUptimeCharts({ modelId }: { modelId: string }) {
	const config = useAppConfig();

	const { data, isLoading, isError } = useQuery<UptimeResponse>({
		queryKey: ["model-uptime", modelId],
		queryFn: async () => {
			const response = await fetch(
				`${config.apiUrl}/internal/models/${encodeURIComponent(modelId)}/uptime`,
			);
			if (!response.ok) {
				throw new Error("Failed to fetch uptime");
			}
			return await response.json();
		},
		refetchInterval: 60_000,
		staleTime: 30_000,
	});

	if (isLoading) {
		return (
			<div className="space-y-6">
				{[1, 2, 3].map((i) => (
					<div
						key={i}
						className="h-[360px] animate-pulse rounded-lg border border-border bg-muted/30"
					/>
				))}
			</div>
		);
	}

	if (isError || !data || data.providers.length === 0) {
		return (
			<Card>
				<CardContent className="flex h-40 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
					<Zap className="h-6 w-6" />
					No uptime data is available for this model in the last 4 hours.
				</CardContent>
			</Card>
		);
	}

	return (
		<div className="space-y-6">
			{data.providers.map((provider) => (
				<ProviderUptimeCard key={provider.providerId} provider={provider} />
			))}
		</div>
	);
}
