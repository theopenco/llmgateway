/**
 * Service tiers that model_provider_mapping_history tracks separately for
 * routing. The standard tier is the remainder of each row's totals.
 */
export const ROUTED_SERVICE_TIERS = ["flex", "priority"] as const;

export type RoutedServiceTier = (typeof ROUTED_SERVICE_TIERS)[number];

export function isRoutedServiceTier(
	value: unknown,
): value is RoutedServiceTier {
	return ROUTED_SERVICE_TIERS.some((tier) => tier === value);
}

/**
 * Routing metrics kept per tier, keyed by column suffix, mapped to the
 * all-traffic column holding the same metric. `flexLogsCount` is the flex
 * slice of `logsCount`, and so on.
 */
export const TIER_ROUTING_METRICS = {
	LogsCount: "logsCount",
	ClientErrorsCount: "clientErrorsCount",
	GatewayErrorsCount: "gatewayErrorsCount",
	UpstreamErrorsCount: "upstreamErrorsCount",
	TotalOutputTokens: "totalOutputTokens",
	TotalDuration: "totalDuration",
	TotalTimeToFirstToken: "totalTimeToFirstToken",
	TotalTimeToFirstReasoningToken: "totalTimeToFirstReasoningToken",
	TimeToFirstTokenCount: "timeToFirstTokenCount",
	TimeToFirstReasoningTokenCount: "timeToFirstReasoningTokenCount",
} as const;

export type TierRoutingMetric = keyof typeof TIER_ROUTING_METRICS;

export type TierRoutingMetricColumn =
	`${RoutedServiceTier}${TierRoutingMetric}`;

export const TIER_ROUTING_METRIC_NAMES = Object.keys(
	TIER_ROUTING_METRICS,
) as TierRoutingMetric[];

export function tierRoutingMetricColumn(
	tier: RoutedServiceTier,
	metric: TierRoutingMetric,
): TierRoutingMetricColumn {
	return `${tier}${metric}`;
}

export const TIER_ROUTING_METRIC_COLUMNS: readonly TierRoutingMetricColumn[] =
	ROUTED_SERVICE_TIERS.flatMap((tier) =>
		TIER_ROUTING_METRIC_NAMES.map((metric) =>
			tierRoutingMetricColumn(tier, metric),
		),
	);
