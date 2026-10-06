import { useMemo } from "react";

import { SegmentedUrlSelector } from "@/components/segmented-url-selector";
import { Badge } from "@/components/ui/badge";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";

import { ContributionLegend } from "./contribution-bar";
import { ExcludedMappingRow, ProviderVerdictRow } from "./provider-verdict-row";
import { ScenarioMatrix } from "./scenario-matrix";
import { describeVerdict } from "./verdict";

import type {
	MetricInputs,
	MetricSource,
	RoutingAnalytics,
	RoutingScenario,
} from "./types";

export const DEFAULT_SCENARIO_ID = "streaming";

export function metricsBySource(
	data: RoutingAnalytics,
	source: MetricSource,
): Map<string, MetricInputs> {
	const rows = source === "live" ? data.live.providers : data.summary;
	return new Map(rows.map((row) => [row.providerId, row]));
}

function sourceOptions(data: RoutingAnalytics) {
	return [
		{
			value: "live" as const,
			label: `Live · last ${data.live.windowMinutes} min, tier-weighted`,
		},
		{ value: "window" as const, label: `Window average (${data.window})` },
	];
}

function WeightBadges({ scenario }: { scenario: RoutingScenario }) {
	const weights = scenario.effectiveWeights;
	return (
		<div className="flex flex-wrap gap-1.5">
			{(
				[
					["Price", weights.price],
					["Uptime", weights.uptime],
					["Throughput", weights.throughput],
					["Latency", weights.latency],
					["Cache", weights.cache],
				] as const
			)
				.filter(([, weight]) => weight > 0)
				.map(([label, weight]) => (
					<Badge key={label} variant="secondary" className="text-xs">
						{label}: {((weight / weights.total) * 100).toFixed(1)}%
					</Badge>
				))}
			{scenario.cachePricing ? (
				<Badge variant="outline" className="text-xs font-normal">
					assumes {(scenario.cachePricing.hitRate * 100).toFixed(0)}% cache hit
					rate, output at {(scenario.cachePricing.outputRatio * 100).toFixed(0)}
					% of input
				</Badge>
			) : null}
		</div>
	);
}

export function RankingCard({
	data,
	source,
	scenarioId,
	providerName,
	providerColor,
	onSelectScenario,
}: {
	data: RoutingAnalytics;
	source: MetricSource;
	scenarioId: string;
	providerName: (providerId: string) => string;
	providerColor: (providerId: string) => string | undefined;
	onSelectScenario: (scenarioId: string) => void;
}) {
	const scenario =
		data.scenarios.find((s) => s.id === scenarioId) ?? data.scenarios[0];
	const result = scenario[source];
	const metrics = useMemo(() => metricsBySource(data, source), [data, source]);
	const scale = Math.max(
		0,
		...result.providers.map((entry) =>
			Math.max(entry.score, entry.breakdown.baseScore),
		),
	);
	const electionsByProvider = new Map(
		data.elections.byProvider.map((entry) => [entry.providerId, entry]),
	);
	const excluded = data.mappings.filter((mapping) => !mapping.routable);
	const best = result.providers[0];
	const verdictContext = {
		rows: result.providers,
		weights: scenario.effectiveWeights,
		metricsByProvider: metrics,
		stickyScoreMargin: data.config.sticky.scoreMargin,
		uptimePenaltyThreshold: data.config.thresholds.uptimePenalty,
		providerName,
	};

	return (
		<>
			<Card>
				<CardHeader className="space-y-4 border-b p-4 sm:p-6">
					<div>
						<CardTitle>Why each mapping ranks where it does</CardTitle>
						<CardDescription className="max-w-3xl">
							Every routable mapping scored with the router&apos;s own formula,
							ranked best first. The bar is the score split into its parts on a
							scale shared by all rows (hover for numbers); the sentence names
							the factors behind the gap to the winner. The right column is how
							the mapping&apos;s traffic actually arrived in the {data.window}{" "}
							window: only <strong>score-decided</strong> traffic follows this
							ranking.
						</CardDescription>
					</div>
					<div className="flex flex-col gap-2">
						<SegmentedUrlSelector
							compact
							param="source"
							value={source}
							defaultValue="live"
							options={sourceOptions(data)}
							className="w-fit"
						/>
						<SegmentedUrlSelector
							compact
							param="scenario"
							value={scenario.id}
							defaultValue={DEFAULT_SCENARIO_ID}
							options={data.scenarios.map((s) => ({
								value: s.id,
								label: s.label,
							}))}
							className="w-fit"
						/>
					</div>
					<p className="text-xs text-muted-foreground">
						{scenario.description}
					</p>
					<WeightBadges scenario={scenario} />
				</CardHeader>
				<CardContent className="p-0">
					{best ? (
						<div className="divide-y">
							{result.providers.map((entry, index) => (
								<ProviderVerdictRow
									key={entry.providerId}
									rank={index + 1}
									entry={entry}
									best={best}
									verdict={describeVerdict(entry, verdictContext)}
									scale={scale}
									providerName={providerName(entry.providerId)}
									color={providerColor(entry.providerId)}
									isImageModel={data.model.isImageModel}
									elections={electionsByProvider.get(entry.providerId)}
									totalElections={data.elections.requestCount}
								/>
							))}
							{excluded.map((mapping) => (
								<ExcludedMappingRow
									key={mapping.providerId}
									providerName={mapping.providerName}
									providerId={mapping.providerId}
									color={providerColor(mapping.providerId)}
									excludedReasons={mapping.excludedReasons}
									elections={electionsByProvider.get(mapping.providerId)}
									totalElections={data.elections.requestCount}
								/>
							))}
						</div>
					) : (
						<p className="p-6 text-sm text-muted-foreground">
							No routable mapping to score.
						</p>
					)}
					<div className="space-y-2 border-t p-4 text-xs text-muted-foreground sm:px-6">
						<ContributionLegend />
						<p>
							Lowest score wins. Missing metrics fall back to{" "}
							{data.config.thresholds.defaultUptime}% uptime,{" "}
							{data.config.thresholds.defaultLatency} ms latency and{" "}
							{data.config.thresholds.defaultThroughput} tok/s. Below{" "}
							{data.config.thresholds.uptimePenalty}% uptime an exponential
							penalty is added. An organization stays on its previous provider
							while that provider is within {data.config.sticky.scoreMargin} of
							the best score and above {data.config.sticky.uptimeThreshold}%
							uptime; sessions stay pinned until uptime drops below{" "}
							{data.config.session.uptimeThreshold}%.{" "}
							{Math.round(data.config.thresholds.explorationRate * 100)}% of
							requests are routed randomly for exploration. Prices use
							platform-wide discounts only.
						</p>
					</div>
				</CardContent>
			</Card>

			<Card>
				<CardHeader className="border-b p-4 sm:p-6">
					<CardTitle>Who wins by request shape</CardTitle>
					<CardDescription className="max-w-3xl">
						The router reshapes the score per request: streaming adds latency,
						large prompts and sessions price cached input in, and{" "}
						<span className="font-mono">routing</span> preferences collapse the
						weights. Highlighted rows elect a different mapping than a plain
						streaming request. Click a row to inspect it above.
					</CardDescription>
				</CardHeader>
				<CardContent className="p-0">
					<ScenarioMatrix
						scenarios={data.scenarios}
						source={source}
						selectedScenarioId={scenario.id}
						stickyScoreMargin={data.config.sticky.scoreMargin}
						providerName={providerName}
						onSelect={onSelectScenario}
					/>
				</CardContent>
			</Card>
		</>
	);
}
