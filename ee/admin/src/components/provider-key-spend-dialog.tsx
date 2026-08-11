"use client";

import { format } from "date-fns";
import { BarChart3 } from "lucide-react";
import { useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	ChartContainer,
	ChartTooltip,
	ChartTooltipContent,
} from "@/components/ui/chart";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { useApi } from "@/lib/fetch-client";
import { formatUsd } from "@/lib/provider-key-spend";

import type { ChartConfig } from "@/components/ui/chart";

type SpendWindow = "1d" | "7d" | "30d" | "90d";

const WINDOWS: { key: SpendWindow; label: string }[] = [
	{ key: "1d", label: "24h" },
	{ key: "7d", label: "7d" },
	{ key: "30d", label: "30d" },
	{ key: "90d", label: "90d" },
];

const chartConfig = {
	cost: { label: "Upstream cost", color: "hsl(221 83% 53%)" },
} satisfies ChartConfig;

const currencyFormatter = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
	maximumFractionDigits: 4,
});

/**
 * Time-series view of what a single provider credential spent upstream, backed
 * by `provider_key_hourly_stats`. Complements the lifetime `usage` counter in
 * the table: the counter says whether a key is near its cap, this says when the
 * spend happened and which tenant caused it.
 */
export function ProviderKeySpendDialog({
	providerKeyId,
	label,
}: {
	providerKeyId: string;
	label: string;
}) {
	const [open, setOpen] = useState(false);
	const [window, setWindow] = useState<SpendWindow>("7d");
	const $api = useApi();

	const { data, isLoading } = $api.useQuery(
		"get",
		"/admin/provider-keys/{providerKeyId}/spend",
		{
			params: { path: { providerKeyId }, query: { window } },
		},
		// The dialog is rendered once per row; only fetch for the one that opens.
		{ enabled: open },
	);

	const points = data?.data ?? [];
	const organizations = data?.organizations ?? [];
	const bucketIsHour = data?.bucket === "hour";
	const windowTokens = points.reduce(
		(sum, point) => sum + Number(point.totalTokens),
		0,
	);
	// The rollup only returns buckets that saw traffic, which would shrink the
	// axis to the busy days; zero-fill against the window's full bucket grid so
	// the chart always covers the selected duration.
	const chartData = useMemo(() => {
		const byTimestamp = new Map(
			points.map((point) => [point.timestamp, point]),
		);
		return (data?.buckets ?? []).map(
			(timestamp) =>
				byTimestamp.get(timestamp) ?? { timestamp, cost: 0, requestCount: 0 },
		);
	}, [data?.buckets, points]);

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button
					variant="ghost"
					size="sm"
					aria-label={`View spend for ${label}`}
				>
					<BarChart3 className="h-4 w-4" />
				</Button>
			</DialogTrigger>
			<DialogContent className="max-w-3xl">
				<DialogHeader>
					<DialogTitle>Spend — {label}</DialogTitle>
					<DialogDescription>
						Upstream provider cost attributed to this credential. Cached
						responses never reach the provider and are recorded at zero cost, so
						they do not appear here.
					</DialogDescription>
				</DialogHeader>

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

				{isLoading ? (
					<div className="h-64 animate-pulse rounded-md bg-muted" />
				) : (
					<>
						<div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
							<Stat
								label="Window spend"
								value={currencyFormatter.format(data?.totalCost ?? 0)}
							/>
							<Stat
								label="Requests"
								value={(data?.totalRequests ?? 0).toLocaleString()}
							/>
							<Stat label="Tokens" value={windowTokens.toLocaleString()} />
							<Stat
								label="Lifetime spend"
								value={
									data
										? `${formatUsd(data.key.usage)}${
												data.key.usageLimit !== null
													? ` of ${formatUsd(data.key.usageLimit)}`
													: ""
											}`
										: "—"
								}
							/>
						</div>

						{points.length === 0 ? (
							<p className="py-10 text-center text-sm text-muted-foreground">
								No attributed spend in this window.
							</p>
						) : (
							<ChartContainer config={chartConfig} className="h-64 w-full">
								<AreaChart data={chartData}>
									<CartesianGrid vertical={false} />
									<XAxis
										dataKey="timestamp"
										tickLine={false}
										axisLine={false}
										tickFormatter={(value: string) =>
											format(new Date(value), bucketIsHour ? "HH:mm" : "MMM d")
										}
									/>
									<YAxis
										tickLine={false}
										axisLine={false}
										width={70}
										tickFormatter={(value: number) =>
											currencyFormatter.format(value)
										}
									/>
									<ChartTooltip
										content={
											<ChartTooltipContent
												labelFormatter={(value) =>
													format(
														new Date(value as string),
														bucketIsHour ? "MMM d, HH:mm" : "MMM d, yyyy",
													)
												}
											/>
										}
									/>
									<Area
										dataKey="cost"
										type="monotone"
										stroke="var(--color-cost)"
										fill="var(--color-cost)"
										fillOpacity={0.2}
									/>
								</AreaChart>
							</ChartContainer>
						)}

						{organizations.length > 0 ? (
							<div>
								<div className="mb-2 flex items-center gap-2">
									<h4 className="text-sm font-medium">By organization</h4>
									{data?.key.managed ? (
										<Badge variant="outline">shared credential</Badge>
									) : null}
								</div>
								<div className="max-h-56 overflow-y-auto rounded-md border border-border/60">
									<Table>
										<TableHeader>
											<TableRow>
												<TableHead>Organization</TableHead>
												<TableHead className="text-right">Requests</TableHead>
												<TableHead className="text-right">Cost</TableHead>
											</TableRow>
										</TableHeader>
										<TableBody>
											{organizations.map((org) => (
												<TableRow key={org.organizationId}>
													<TableCell className="text-sm">
														{org.organizationName ?? org.organizationId}
													</TableCell>
													<TableCell className="text-right tabular-nums">
														{org.requestCount.toLocaleString()}
													</TableCell>
													<TableCell className="text-right tabular-nums">
														{currencyFormatter.format(org.cost)}
													</TableCell>
												</TableRow>
											))}
										</TableBody>
									</Table>
								</div>
							</div>
						) : null}
					</>
				)}
			</DialogContent>
		</Dialog>
	);
}

function Stat({ label, value }: { label: string; value: string }) {
	return (
		<div className="rounded-lg border border-border/60 p-3">
			<div className="text-xs text-muted-foreground">{label}</div>
			<div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
		</div>
	);
}
