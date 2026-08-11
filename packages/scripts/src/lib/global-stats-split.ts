/**
 * Pure splitting logic for the global stats attribution backfill.
 *
 * Kept separate from the script so it can be tested without the script's
 * top-level `main()` running on import.
 */

import type { GlobalStatsOrgKind, GlobalStatsUsedMode } from "@llmgateway/db";

/** Metrics whose per-mode value comes from a denormalized pair — exact, never prorated. */
export const PAIR_METRICS = ["requestCount", "cost", "dataStorageCost"] as const;

/** Integer counters. Split with largest-remainder so the parts sum exactly. */
export const INT_METRICS = [
	"errorCount",
	"cacheCount",
	"streamedCount",
	"nonStreamedCount",
	"completedCount",
	"lengthLimitCount",
	"contentFilterCount",
	"toolCallsCount",
	"canceledCount",
	"unknownFinishCount",
	"clientErrorCount",
	"gatewayErrorCount",
	"upstreamErrorCount",
] as const;

/** `decimal` token columns — whole numbers in practice, so split like integers. */
export const TOKEN_METRICS = [
	"inputTokens",
	"outputTokens",
	"totalTokens",
	"reasoningTokens",
	"cachedTokens",
	"cacheWriteTokens",
] as const;

/** float4 money columns, split proportionally. */
export const REAL_METRICS = [
	"inputCost",
	"outputCost",
	"requestCost",
	"discountSavings",
	"imageInputCost",
	"imageOutputCost",
	"audioInputCost",
	"audioOutputCost",
	"videoOutputCost",
	"cachedInputCost",
	"cacheWriteInputCost",
] as const;

export type MetricKey =
	| (typeof PAIR_METRICS)[number]
	| (typeof INT_METRICS)[number]
	| (typeof TOKEN_METRICS)[number]
	| (typeof REAL_METRICS)[number];

/** Metrics that must stay whole numbers after the split. */
export const WHOLE_METRICS = new Set<MetricKey>([
	"requestCount",
	...INT_METRICS,
	...TOKEN_METRICS,
]);

export const ALL_METRICS: MetricKey[] = [
	...PAIR_METRICS,
	...INT_METRICS,
	...TOKEN_METRICS,
	...REAL_METRICS,
];

/** Metrics the project hourly tables scale by request share rather than a pair. */
export const SHARE_METRICS: MetricKey[] = [
	...INT_METRICS,
	...TOKEN_METRICS,
	...REAL_METRICS,
];

export type Metrics = Record<MetricKey, number>;

export function emptyMetrics(): Metrics {
	return Object.fromEntries(ALL_METRICS.map((m) => [m, 0])) as Metrics;
}

export interface Candidate {
	usedMode: Exclude<GlobalStatsUsedMode, "unknown">;
	orgKind: GlobalStatsOrgKind;
	metrics: Metrics;
}

export interface GlobalRow {
	id: string;
	keyValues: string[];
	usedMode: GlobalStatsUsedMode;
	orgKind: GlobalStatsOrgKind;
	metrics: Metrics;
}

export interface SplitPart {
	keyValues: string[];
	usedMode: GlobalStatsUsedMode;
	orgKind: GlobalStatsOrgKind;
	metrics: Metrics;
}

/**
 * Distribute `total` across `weights` as whole numbers summing to exactly
 * `total`. Plain rounding would drift by a request or two per row, which across
 * hundreds of thousands of rows stops the page adding up all over again.
 */
export function splitWhole(total: number, weights: number[]): number[] {
	if (weights.length === 0) {
		return [];
	}
	if (total === 0) {
		return weights.map(() => 0);
	}
	const sum = weights.reduce((a, b) => a + b, 0);
	if (sum <= 0) {
		// No signal to distribute on — keep it all rather than silently dropping it.
		return weights.map((_, i) => (i === 0 ? total : 0));
	}
	const raw = weights.map((w) => (total * w) / sum);
	const parts = raw.map((v) => Math.floor(v));
	let remainder = total - parts.reduce((a, b) => a + b, 0);
	const byFraction = raw
		.map((v, i) => ({ i, frac: v - Math.floor(v) }))
		.sort((a, b) => b.frac - a.frac);
	for (let k = 0; remainder > 0 && k < byFraction.length; k++) {
		parts[byFraction[k].i]++;
		remainder--;
	}
	return parts;
}

export function splitReal(total: number, weights: number[]): number[] {
	if (weights.length === 0) {
		return [];
	}
	if (total === 0) {
		return weights.map(() => 0);
	}
	const sum = weights.reduce((a, b) => a + b, 0);
	if (sum <= 0) {
		return weights.map((_, i) => (i === 0 ? total : 0));
	}
	return weights.map((w) => (total * w) / sum);
}

/**
 * Split one global row across the candidate tuples, scaling each metric so the
 * parts sum back to exactly what the row held. The global tables stay
 * authoritative for totals; the candidates only decide the proportions.
 */
export function splitRow(row: GlobalRow, candidates: Candidate[]): SplitPart[] {
	const requestWeights = candidates.map((c) => c.metrics.requestCount);
	const parts = candidates.map(() => emptyMetrics());

	for (const metric of ALL_METRICS) {
		let weights = candidates.map((c) => c.metrics[metric]);
		// A metric the project side never recorded still has to go somewhere;
		// fall back to the request distribution.
		if (weights.every((w) => w === 0)) {
			weights = requestWeights;
		}
		const values = WHOLE_METRICS.has(metric)
			? splitWhole(Math.round(row.metrics[metric]), weights)
			: splitReal(row.metrics[metric], weights);
		values.forEach((v, i) => {
			parts[i][metric] = v;
		});
	}

	return candidates.map((c, i) => ({
		keyValues: row.keyValues,
		// Only ever resolve the dimension that was actually unknown.
		usedMode: row.usedMode === "unknown" ? c.usedMode : row.usedMode,
		orgKind: row.orgKind === "unknown" ? c.orgKind : row.orgKind,
		metrics: parts[i],
	}));
}
