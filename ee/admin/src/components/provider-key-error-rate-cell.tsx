import { cn } from "@/lib/utils";

import { formatNumber } from "@llmgateway/shared/number-format";

export interface RecentCredentialStats {
	requestCount: number;
	errorCount: number;
	upstreamErrorCount: number;
}

/** Share of failed requests at which the rate stops being background noise. */
const WARNING_THRESHOLD = 0.02;
/** Share of failed requests that suggests the credential itself is unhealthy. */
const CRITICAL_THRESHOLD = 0.1;

/**
 * Rolling 24h error rate for one credential. Deliberately quiet: at a normal
 * rate it reads as muted small print next to the spend, and only takes colour
 * once enough requests have failed that an operator should look.
 */
export function ProviderKeyErrorRateCell({
	stats,
}: {
	stats: RecentCredentialStats;
}) {
	if (stats.requestCount === 0) {
		return (
			<span
				className="text-xs text-muted-foreground"
				title="No requests attributed to this credential in the last 24 hours."
			>
				—
			</span>
		);
	}

	const fraction = stats.errorCount / stats.requestCount;
	const percent = fraction * 100;
	// One colour class rather than stacked conditionals: the amber pair carries
	// a `dark:` variant, which would otherwise outrank an unprefixed
	// `text-destructive` in dark mode and paint a critical rate amber.
	const tone =
		fraction >= CRITICAL_THRESHOLD
			? "text-destructive"
			: fraction >= WARNING_THRESHOLD
				? "text-amber-600 dark:text-amber-500"
				: "text-muted-foreground";

	return (
		<span
			className={cn("text-xs tabular-nums", tone)}
			title={`${formatNumber(stats.errorCount)} of ${formatNumber(
				stats.requestCount,
			)} requests failed in the last 24 hours (${formatNumber(
				stats.upstreamErrorCount,
			)} returned by the provider).`}
		>
			{percent > 0 && percent < 0.1 ? "<0.1%" : `${percent.toFixed(1)}%`}
		</span>
	);
}
