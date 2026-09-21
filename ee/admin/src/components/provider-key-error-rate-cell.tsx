"use client";

import { useState } from "react";

import { SparklineLine } from "@/components/sparkline";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { useApi } from "@/lib/fetch-client";
import { cn } from "@/lib/utils";

import { formatNumber } from "@llmgateway/shared/number-format";

import type { DailyCredentialPoint } from "@/lib/provider-key-spend";

export interface RecentCredentialStats {
	requestCount: number;
	errorCount: number;
	upstreamErrorCount: number;
}

/** Share of failed requests at which the rate stops being background noise. */
const WARNING_THRESHOLD = 0.02;
/** Share of failed requests that suggests the credential itself is unhealthy. */
const CRITICAL_THRESHOLD = 0.1;

/** Sub-0.1% rates round to "0.0%", which reads as "no errors" — say so instead. */
function formatErrorPercent(fraction: number) {
	const percent = fraction * 100;
	return percent > 0 && percent < 0.1 ? "<0.1%" : `${percent.toFixed(1)}%`;
}

function toneForFraction(fraction: number) {
	// One colour class rather than stacked conditionals: the amber pair carries
	// a `dark:` variant, which would otherwise outrank an unprefixed
	// `text-destructive` in dark mode and paint a critical rate amber.
	return fraction >= CRITICAL_THRESHOLD
		? "text-destructive"
		: fraction >= WARNING_THRESHOLD
			? "text-amber-600 dark:text-amber-500"
			: "text-muted-foreground";
}

/**
 * Rolling 24h error rate for one credential. Deliberately quiet: at a normal
 * rate it reads as muted small print next to the spend, and only takes colour
 * once enough requests have failed that an operator should look. Hovering adds
 * the per-model breakdown, which answers the follow-up question the headline
 * rate always raises — one broken model, or the whole credential?
 */
export function ProviderKeyErrorRateCell({
	providerKeyId,
	stats,
	daily,
}: {
	providerKeyId: string;
	stats: RecentCredentialStats;
	daily?: DailyCredentialPoint[];
}) {
	const [open, setOpen] = useState(false);

	// The 24h headline and the 7d trend are independent: a credential can be
	// quiet today and still have a week worth showing, so the trend renders even
	// when the rate cannot.
	const trend = daily ? <DailyErrorRateSparkline daily={daily} /> : null;

	if (stats.requestCount === 0) {
		return (
			<div className="space-y-1">
				<span
					className="text-xs text-muted-foreground"
					title="No requests attributed to this credential in the last 24 hours."
				>
					—
				</span>
				{trend}
			</div>
		);
	}

	const fraction = stats.errorCount / stats.requestCount;

	return (
		<div className="space-y-1">
			<TooltipProvider delayDuration={200}>
				<Tooltip open={open} onOpenChange={setOpen}>
					<TooltipTrigger asChild>
						<span
							className={cn(
								"text-xs tabular-nums underline decoration-dotted underline-offset-4",
								toneForFraction(fraction),
							)}
						>
							{formatErrorPercent(fraction)}
						</span>
					</TooltipTrigger>
					<TooltipContent className="max-w-sm">
						<p>
							{formatNumber(stats.errorCount)} of{" "}
							{formatNumber(stats.requestCount)} requests failed in the last 24
							hours ({formatNumber(stats.upstreamErrorCount)} returned by the
							provider).
						</p>
						<ModelErrorBreakdown providerKeyId={providerKeyId} enabled={open} />
					</TooltipContent>
				</Tooltip>
			</TooltipProvider>
			{trend}
		</div>
	);
}

/**
 * Daily error rate over the sparkline window, so a rate that has been bad all
 * week reads differently from one that broke this morning. Scaled against the
 * critical threshold rather than the row's own maximum: the height then means
 * the same thing on every row, and a credential failing everything tops out
 * while a 0.5% blip stays flat.
 */
function DailyErrorRateSparkline({ daily }: { daily: DailyCredentialPoint[] }) {
	const rates = daily.map((point) =>
		point.requestCount === 0 ? null : point.errorCount / point.requestCount,
	);
	if (rates.every((rate) => rate === null)) {
		return null;
	}

	const peak = Math.max(...rates.map((rate) => rate ?? 0));
	// Coloured by the most recent day with traffic, not by the week's peak, so the
	// line agrees with the headline rate above it: a spike five days ago should
	// show as a shape, not as a credential that is red right now.
	const latest = rates.filter((rate) => rate !== null).at(-1) ?? 0;

	return (
		<div className={toneForFraction(latest)}>
			<SparklineLine
				values={rates}
				max={Math.max(peak, CRITICAL_THRESHOLD)}
				points={daily.map((point, index) => {
					const rate = rates[index];
					const suffix =
						index === daily.length - 1 ? " — today, still in progress" : "";
					return {
						label: `${point.date.slice(0, 10)}: ${
							rate === null
								? "no requests"
								: `${formatErrorPercent(rate)} (${formatNumber(
										point.errorCount,
									)}/${formatNumber(point.requestCount)})`
						}${suffix}`,
					};
				})}
				ariaLabel={`Daily error rate over the last ${daily.length} UTC days, peaking at ${formatErrorPercent(peak)}`}
			/>
		</div>
	);
}

/**
 * Per-model split, worst error rate first. Backed by
 * `global_provider_key_model_stats`, which is day-grained and lags the hourly
 * rollup the headline rate uses — hence the explicit window line rather than
 * letting the totals silently disagree.
 */
function ModelErrorBreakdown({
	providerKeyId,
	enabled,
}: {
	providerKeyId: string;
	enabled: boolean;
}) {
	const $api = useApi();
	const { data, isLoading, isError } = $api.useQuery(
		"get",
		"/admin/provider-keys/{providerKeyId}/model-errors",
		{ params: { path: { providerKeyId } } },
		// One cell per row; only the hovered one fetches.
		{ enabled },
	);

	if (isLoading) {
		return <p className="mt-2 opacity-70">Loading model breakdown…</p>;
	}
	if (isError) {
		return <p className="mt-2 opacity-70">Model breakdown unavailable.</p>;
	}
	if (!data || data.models.length === 0) {
		return <p className="mt-2 opacity-70">No per-model data recorded yet.</p>;
	}

	return (
		<div className="mt-2 border-t border-background/20 pt-2">
			<p className="mb-1 opacity-70">
				By model, since {data.since.slice(0, 10)} (UTC days)
			</p>
			<ul className="space-y-0.5">
				{data.models.map((row) => (
					<li
						key={`${row.usedProvider}:${row.usedModel}`}
						className="flex items-baseline justify-between gap-3"
					>
						<span className="truncate">{row.usedModel}</span>
						<span className="shrink-0 tabular-nums">
							{formatErrorPercent(row.errorCount / row.requestCount)}
							<span className="opacity-70">
								{" "}
								({formatNumber(row.errorCount)}/{formatNumber(row.requestCount)}
								)
							</span>
						</span>
					</li>
				))}
				{data.rest ? (
					<li className="flex items-baseline justify-between gap-3 opacity-70">
						<span className="truncate">
							{formatNumber(data.rest.modelCount)} more models
						</span>
						<span className="shrink-0 tabular-nums">
							{formatErrorPercent(
								data.rest.requestCount === 0
									? 0
									: data.rest.errorCount / data.rest.requestCount,
							)}{" "}
							({formatNumber(data.rest.errorCount)}/
							{formatNumber(data.rest.requestCount)})
						</span>
					</li>
				) : null}
			</ul>
		</div>
	);
}
