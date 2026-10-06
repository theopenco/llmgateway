import type { paths } from "@/lib/api/v1";

export type RoutingAnalytics =
	paths["/admin/routing-analytics"]["get"]["responses"]["200"]["content"]["application/json"];

export type RoutingScenario = RoutingAnalytics["scenarios"][number];

export type ScenarioResult = RoutingScenario["live"];

export type ScenarioProvider = ScenarioResult["providers"][number];

export type ScoreBreakdown = ScenarioProvider["breakdown"];

export type ProviderElections =
	RoutingAnalytics["elections"]["byProvider"][number];

export type EffectiveWeights = RoutingScenario["effectiveWeights"];

/** Routing inputs of one mapping, from either metric source. */
export interface MetricInputs {
	uptime: number | null;
	latency: number | null;
	throughput: number | null;
}

export type MetricSource = "live" | "window";
