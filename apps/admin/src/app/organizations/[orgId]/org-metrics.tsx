"use client";

import {
	Activity,
	CircleDollarSign,
	Hash,
	Loader2,
	Server,
	TrendingDown,
} from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
	loadMetricsAction,
	type OrganizationMetrics,
	type TokenWindow,
} from "@/lib/admin-organizations";
import { cn } from "@/lib/utils";

const validWindows = new Set<TokenWindow>([
	"1h",
	"4h",
	"12h",
	"1d",
	"7d",
	"30d",
	"90d",
	"365d",
]);

function parseWindow(value: string | null): TokenWindow {
	if (value && validWindows.has(value as TokenWindow)) {
		return value as TokenWindow;
	}
	return "1d";
}

function formatCompactNumber(value: number): string {
	if (value >= 1_000_000_000) {
		const formatted = value / 1_000_000_000;
		return `${formatted % 1 === 0 ? formatted.toFixed(0) : formatted.toFixed(1)}B`;
	}
	if (value >= 1_000_000) {
		const formatted = value / 1_000_000;
		return `${formatted % 1 === 0 ? formatted.toFixed(0) : formatted.toFixed(1)}M`;
	}
	if (value >= 1_000) {
		const formatted = value / 1_000;
		return `${formatted % 1 === 0 ? formatted.toFixed(0) : formatted.toFixed(1)}k`;
	}
	return value.toLocaleString("en-US");
}

const currencyFormatter = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
	maximumFractionDigits: 4,
});

function safeNumber(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function MetricCard({
	label,
	value,
	subtitle,
	icon,
	accent,
}: {
	label: string;
	value: string;
	subtitle?: string;
	icon?: React.ReactNode;
	accent?: "green" | "blue" | "purple";
}) {
	return (
		<div className="bg-card text-card-foreground flex flex-col justify-between gap-3 rounded-xl border border-border/60 p-5 shadow-sm">
			<div className="flex items-start justify-between gap-3">
				<div>
					<p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
						{label}
					</p>
					<p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
					{subtitle ? (
						<p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
					) : null}
				</div>
				{icon ? (
					<div
						className={cn(
							"inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-xs",
							accent === "green" &&
								"border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
							accent === "blue" &&
								"border-sky-500/30 bg-sky-500/10 text-sky-400",
							accent === "purple" &&
								"border-violet-500/30 bg-violet-500/10 text-violet-400",
						)}
					>
						{icon}
					</div>
				) : null}
			</div>
		</div>
	);
}

export function OrgMetricsSection({ orgId }: { orgId: string }) {
	const searchParams = useSearchParams();
	const router = useRouter();
	const pathname = usePathname();

	const window = parseWindow(searchParams.get("window"));
	const [metrics, setMetrics] = useState<OrganizationMetrics | null>(null);
	const [loading, setLoading] = useState(true);

	const loadMetrics = useCallback(
		async (w: TokenWindow) => {
			setLoading(true);
			const data = await loadMetricsAction(orgId, w);
			setMetrics(data);
			setLoading(false);
		},
		[orgId],
	);

	// Load metrics automatically on mount and when window changes
	useEffect(() => {
		void loadMetrics(window);
	}, [loadMetrics, window]);

	const handleWindowChange = useCallback(
		(w: TokenWindow) => {
			const params = new URLSearchParams(searchParams.toString());
			if (w === "1d") {
				params.delete("window");
			} else {
				params.set("window", w);
			}
			const query = params.toString();
			router.push(query ? `${pathname}?${query}` : pathname);
		},
		[searchParams, router, pathname],
	);

	if (loading) {
		return (
			<section className="space-y-4">
				<h2 className="text-lg font-semibold">Usage Metrics</h2>
				<div className="flex items-center justify-center gap-2 rounded-lg border border-border/60 p-8 text-sm text-muted-foreground">
					<Loader2 className="h-4 w-4 animate-spin" />
					Loading usage data...
				</div>
			</section>
		);
	}

	if (!metrics) {
		return (
			<section className="space-y-4">
				<h2 className="text-lg font-semibold">Usage Metrics</h2>
				<div className="rounded-lg border border-dashed border-border/60 p-8 text-center text-sm text-muted-foreground">
					No usage data available.
				</div>
			</section>
		);
	}

	const windowLabels: Record<TokenWindow, string> = {
		"1h": "Last 1 hour",
		"4h": "Last 4 hours",
		"12h": "Last 12 hours",
		"1d": "Last 24 hours",
		"7d": "Last 7 days",
		"30d": "Last 30 days",
		"90d": "Last 90 days",
		"365d": "Last 365 days",
	};
	const windowLabel = windowLabels[window];

	return (
		<section className="space-y-4">
			<div className="flex items-center justify-between">
				<div>
					<h2 className="text-lg font-semibold">Usage Metrics</h2>
					<p className="text-xs text-muted-foreground">
						{windowLabel} ({new Date(metrics.startDate).toLocaleDateString()} –{" "}
						{new Date(metrics.endDate).toLocaleDateString()})
					</p>
				</div>
				<div className="flex items-center gap-1">
					<Button
						variant={window === "1h" ? "default" : "outline"}
						size="sm"
						onClick={() => handleWindowChange("1h")}
					>
						1h
					</Button>
					<Button
						variant={window === "4h" ? "default" : "outline"}
						size="sm"
						onClick={() => handleWindowChange("4h")}
					>
						4h
					</Button>
					<Button
						variant={window === "12h" ? "default" : "outline"}
						size="sm"
						onClick={() => handleWindowChange("12h")}
					>
						12h
					</Button>
					<Button
						variant={window === "1d" ? "default" : "outline"}
						size="sm"
						onClick={() => handleWindowChange("1d")}
					>
						24h
					</Button>
					<Button
						variant={window === "7d" ? "default" : "outline"}
						size="sm"
						onClick={() => handleWindowChange("7d")}
					>
						7d
					</Button>
					<Button
						variant={window === "30d" ? "default" : "outline"}
						size="sm"
						onClick={() => handleWindowChange("30d")}
					>
						30d
					</Button>
					<Button
						variant={window === "90d" ? "default" : "outline"}
						size="sm"
						onClick={() => handleWindowChange("90d")}
					>
						90d
					</Button>
					<Button
						variant={window === "365d" ? "default" : "outline"}
						size="sm"
						onClick={() => handleWindowChange("365d")}
					>
						365d
					</Button>
				</div>
			</div>
			<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
				<MetricCard
					label="Total Requests"
					value={formatCompactNumber(safeNumber(metrics.totalRequests))}
					subtitle="All API requests in the selected time window"
					icon={<Hash className="h-4 w-4" />}
					accent="blue"
				/>
				<MetricCard
					label="Total Tokens"
					value={formatCompactNumber(safeNumber(metrics.totalTokens))}
					subtitle={`Total tokens across all requests (${windowLabel.toLowerCase()})`}
					icon={<Activity className="h-4 w-4" />}
					accent="green"
				/>
				<MetricCard
					label="Total Cost"
					value={currencyFormatter.format(safeNumber(metrics.totalCost))}
					subtitle="Sum of metered usage costs (USD)"
					icon={<CircleDollarSign className="h-4 w-4" />}
					accent="purple"
				/>
				<MetricCard
					label="Total Savings"
					value={currencyFormatter.format(safeNumber(metrics.discountSavings))}
					subtitle="Discount savings from applied discounts"
					icon={<TrendingDown className="h-4 w-4" />}
					accent="green"
				/>
				<MetricCard
					label="Input Tokens & Cost"
					value={`${formatCompactNumber(safeNumber(metrics.inputTokens))} • ${currencyFormatter.format(safeNumber(metrics.inputCost))}`}
					subtitle="Prompt tokens and associated cost"
					icon={<Activity className="h-4 w-4" />}
					accent="blue"
				/>
				<MetricCard
					label="Output Tokens & Cost"
					value={`${formatCompactNumber(safeNumber(metrics.outputTokens))} • ${currencyFormatter.format(safeNumber(metrics.outputCost))}`}
					subtitle="Completion tokens and associated cost"
					icon={<Activity className="h-4 w-4" />}
					accent="green"
				/>
				<MetricCard
					label="Cached Tokens & Cost"
					value={`${formatCompactNumber(safeNumber(metrics.cachedTokens))} • ${currencyFormatter.format(safeNumber(metrics.cachedCost))}`}
					subtitle="Tokens and cost served from cache (if supported)"
					icon={<Server className="h-4 w-4" />}
					accent="purple"
				/>
				<MetricCard
					label="Most Used Model (by cost)"
					value={metrics.mostUsedModel ?? "—"}
					subtitle={
						metrics.mostUsedModel
							? `${currencyFormatter.format(safeNumber(metrics.mostUsedModelCost))} total cost`
							: "No traffic in selected window"
					}
					icon={<Activity className="h-4 w-4" />}
					accent="blue"
				/>
				<MetricCard
					label="Most Used Provider"
					value={metrics.mostUsedProvider ?? "—"}
					subtitle={
						metrics.mostUsedProvider
							? "Provider for the most expensive model"
							: "No traffic in selected window"
					}
					icon={<Server className="h-4 w-4" />}
					accent="green"
				/>
			</div>
		</section>
	);
}
