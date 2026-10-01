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
import { errorWindowOption } from "@/lib/provider-key-error-window";
import { cn } from "@/lib/utils";

import { deriveStabilityMetrics } from "@llmgateway/shared";
import { formatNumber } from "@llmgateway/shared/number-format";

import type { ErrorWindow } from "@/lib/provider-key-error-window";

export interface RecentCredentialStats {
	requestCount: number;
	clientErrorCount: number;
	gatewayErrorCount: number;
	upstreamErrorCount: number;
}

/** One bucket of the selected window, as the credentials list returns it. */
export interface ErrorSeriesPoint extends RecentCredentialStats {
	date: string;
}

/**
 * Gateway + upstream errors over non-client-error requests, like every other
 * uptime surface: a caller's malformed request says nothing about the
 * credential. `fraction` is null when no request counts toward the rate.
 */
function credentialErrorRate(stats: RecentCredentialStats) {
	const { requestCount, errorsCount, errorRate } = deriveStabilityMetrics({
		logsCount: stats.requestCount,
		clientErrorsCount: stats.clientErrorCount,
		gatewayErrorsCount: stats.gatewayErrorCount,
		upstreamErrorsCount: stats.upstreamErrorCount,
	});
	return {
		requestCount,
		errorsCount,
		fraction: errorRate === null ? null : errorRate / 100,
	};
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
 * Error rate for one credential over the selected window. Deliberately quiet:
 * at a normal rate it reads as muted small print next to the spend, and only
 * takes colour once enough requests have failed that an operator should look.
 * Hovering adds the per-model breakdown, which answers the follow-up question
 * the headline rate always raises — one broken model, or the whole credential?
 */
export function ProviderKeyErrorRateCell({
	providerKeyId,
	window,
	series,
}: {
	providerKeyId: string;
	window: ErrorWindow;
	series: ErrorSeriesPoint[];
}) {
	const [open, setOpen] = useState(false);
	const { label } = errorWindowOption(window);

	const trend = <ErrorRateSparkline window={window} series={series} />;

	// The headline is the series summed, so it always agrees with the line.
	const stats = series.reduce<RecentCredentialStats>(
		(total, point) => ({
			requestCount: total.requestCount + point.requestCount,
			clientErrorCount: total.clientErrorCount + point.clientErrorCount,
			gatewayErrorCount: total.gatewayErrorCount + point.gatewayErrorCount,
			upstreamErrorCount: total.upstreamErrorCount + point.upstreamErrorCount,
		}),
		{
			requestCount: 0,
			clientErrorCount: 0,
			gatewayErrorCount: 0,
			upstreamErrorCount: 0,
		},
	);
	const rate = credentialErrorRate(stats);
	if (rate.fraction === null) {
		return (
			<div className="space-y-1">
				<span
					className="text-xs text-muted-foreground"
					title={`No requests other than client errors attributed to this credential in the ${label}.`}
				>
					—
				</span>
				{trend}
			</div>
		);
	}

	const fraction = rate.fraction;

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
							{formatNumber(rate.errorsCount)} of{" "}
							{formatNumber(rate.requestCount)} requests failed in the {label} (
							{formatNumber(stats.upstreamErrorCount)} returned by the
							provider). {formatNumber(stats.clientErrorCount)} client errors
							are excluded.
						</p>
						<ModelErrorBreakdown providerKeyId={providerKeyId} enabled={open} />
					</TooltipContent>
				</Tooltip>
			</TooltipProvider>
			{trend}
		</div>
	);
}

/** Hover label for one bucket: as much of the timestamp as the grain needs. */
function bucketLabel(window: ErrorWindow, date: string) {
	if (window === "7d") {
		return date.slice(0, 10);
	}
	return `${date.slice(5, 10)} ${date.slice(11, 16)} UTC`;
}

/**
 * Error rate per bucket over the window, so a rate that has been bad throughout
 * reads differently from one that just broke. Scaled against the critical
 * threshold rather than the row's own maximum: the height then means the same
 * thing on every row, and a credential failing everything tops out while a 0.5%
 * blip stays flat.
 */
function ErrorRateSparkline({
	window,
	series,
}: {
	window: ErrorWindow;
	series: ErrorSeriesPoint[];
}) {
	const pointRates = series.map((point) => credentialErrorRate(point));
	const rates = pointRates.map((rate) => rate.fraction);
	if (rates.every((rate) => rate === null)) {
		return null;
	}

	const { label, bucket } = errorWindowOption(window);
	const peak = Math.max(...rates.map((rate) => rate ?? 0));
	// Coloured by the most recent bucket with traffic, not by the window's peak,
	// so a spike early in the window shows as a shape, not as a credential that
	// is red right now.
	const latest = rates.filter((rate) => rate !== null).at(-1) ?? 0;

	return (
		<div className={toneForFraction(latest)}>
			<SparklineLine
				values={rates}
				max={Math.max(peak, CRITICAL_THRESHOLD)}
				points={series.map((point, index) => {
					const rate = rates[index];
					const suffix =
						index === series.length - 1 ? " — still in progress" : "";
					return {
						label: `${bucketLabel(window, point.date)}: ${
							rate === null
								? "no requests"
								: `${formatErrorPercent(rate)} (${formatNumber(
										pointRates[index].errorsCount,
									)}/${formatNumber(pointRates[index].requestCount)})`
						}${suffix}`,
					};
				})}
				ariaLabel={`Error rate per ${bucket} over the ${label}, peaking at ${formatErrorPercent(peak)}`}
			/>
		</div>
	);
}

/**
 * Per-model split, worst error rate first. Backed by
 * `global_provider_key_model_stats`, which is day-grained and lags the sources
 * the headline rate uses — hence the explicit window line rather than
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

	const restRate = data.rest ? credentialErrorRate(data.rest) : null;

	return (
		<div className="mt-2 border-t border-background/20 pt-2">
			<p className="mb-1 opacity-70">
				By model, since {data.since.slice(0, 10)} (UTC days)
			</p>
			<ul className="space-y-0.5">
				{data.models.map((row) => {
					const rate = credentialErrorRate(row);
					return (
						<li
							key={`${row.usedProvider}:${row.usedModel}`}
							className="flex items-baseline justify-between gap-3"
						>
							<span className="truncate">{row.usedModel}</span>
							<span className="shrink-0 tabular-nums">
								{rate.fraction === null
									? "—"
									: formatErrorPercent(rate.fraction)}
								<span className="opacity-70">
									{" "}
									({formatNumber(rate.errorsCount)}/
									{formatNumber(rate.requestCount)})
								</span>
							</span>
						</li>
					);
				})}
				{data.rest && restRate ? (
					<li className="flex items-baseline justify-between gap-3 opacity-70">
						<span className="truncate">
							{formatNumber(data.rest.modelCount)} more models
						</span>
						<span className="shrink-0 tabular-nums">
							{restRate.fraction === null
								? "—"
								: formatErrorPercent(restRate.fraction)}{" "}
							({formatNumber(restRate.errorsCount)}/
							{formatNumber(restRate.requestCount)})
						</span>
					</li>
				) : null}
			</ul>
		</div>
	);
}
