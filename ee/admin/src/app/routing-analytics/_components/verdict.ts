import type {
	EffectiveWeights,
	MetricInputs,
	ScenarioProvider,
	ScoreBreakdown,
} from "./types";

// Differences below this are rounding noise and stay out of the sentence.
const MIN_FACTOR_DELTA = 0.0005;
const MAX_LISTED_FACTORS = 3;

type WeightedFactor = "price" | "uptime" | "throughput" | "latency" | "cache";

interface Factor {
	key: WeightedFactor | "priority";
	contribution: keyof ScoreBreakdown;
	label: string;
	/** How the leader on this factor is described. */
	leadPhrase: string;
}

const FACTORS: Factor[] = [
	{
		key: "price",
		contribution: "priceContribution",
		label: "price",
		leadPhrase: "cheapest",
	},
	{
		key: "uptime",
		contribution: "uptimeContribution",
		label: "uptime",
		leadPhrase: "top uptime",
	},
	{
		key: "throughput",
		contribution: "throughputContribution",
		label: "throughput",
		leadPhrase: "fastest output",
	},
	{
		key: "latency",
		contribution: "latencyContribution",
		label: "latency",
		leadPhrase: "lowest TTFT",
	},
	{
		key: "cache",
		contribution: "cacheContribution",
		label: "cache",
		leadPhrase: "cache support",
	},
	{
		key: "priority",
		contribution: "priorityPenalty",
		label: "priority",
		leadPhrase: "highest priority",
	},
];

export interface VerdictContext {
	/** Ranked rows of the scenario, best first. */
	rows: ScenarioProvider[];
	weights: EffectiveWeights;
	metricsByProvider: Map<string, MetricInputs>;
	stickyScoreMargin: number;
	uptimePenaltyThreshold: number;
	providerName: (providerId: string) => string;
}

export interface Verdict {
	headline: string;
	notes: string[];
}

function factorWeight(factor: Factor, weights: EffectiveWeights): number {
	return factor.key === "priority" ? 1 : weights[factor.key];
}

function factorDetail(
	factor: Factor,
	entry: ScenarioProvider,
	best: ScenarioProvider,
	metrics: MetricInputs | undefined,
	bestMetrics: MetricInputs | undefined,
): string | null {
	switch (factor.key) {
		case "price": {
			if (best.price <= 0) {
				return entry.price > 0 ? "paid vs free" : null;
			}
			const ratio = entry.price / best.price;
			const pct = (ratio - 1) * 100;
			const magnitude = Math.abs(pct);
			const formatted = magnitude.toFixed(magnitude < 10 ? 1 : 0);
			return pct >= 0 ? `${formatted}% dearer` : `${formatted}% cheaper`;
		}
		case "uptime":
			return `${formatMetric(metrics?.uptime, (v) => `${v.toFixed(1)}%`)} vs ${formatMetric(bestMetrics?.uptime, (v) => `${v.toFixed(1)}%`)}`;
		case "throughput":
			return `${formatMetric(metrics?.throughput, (v) => v.toFixed(0))} vs ${formatMetric(bestMetrics?.throughput, (v) => `${v.toFixed(0)} tok/s`)}`;
		case "latency":
			return `${formatMetric(metrics?.latency, (v) => v.toFixed(0))} vs ${formatMetric(bestMetrics?.latency, (v) => `${v.toFixed(0)} ms`)}`;
		case "cache":
			return entry.breakdown.cacheScore > 0 ? "no prompt caching" : null;
		case "priority":
			return "lower provider priority";
	}
}

function formatMetric(
	value: number | null | undefined,
	format: (value: number) => string,
): string {
	return value === null || value === undefined ? "default" : format(value);
}

function signed(value: number): string {
	return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(3)}`;
}

function joinPhrases(phrases: string[]): string {
	if (phrases.length <= 1) {
		return phrases.join("");
	}
	return `${phrases.slice(0, -1).join(", ")} and ${phrases[phrases.length - 1]}`;
}

/**
 * One sentence on why a mapping ranks where it does, read off the same
 * per-factor contributions the router sums: the winner by what it leads on,
 * everyone else by which factors account for the gap to the winner.
 */
export function describeVerdict(
	entry: ScenarioProvider,
	context: VerdictContext,
): Verdict {
	const { rows, weights, metricsByProvider } = context;
	const best = rows[0];
	const notes: string[] = [];
	const metrics = metricsByProvider.get(entry.providerId);
	if (
		!metrics ||
		(metrics.uptime === null &&
			metrics.latency === null &&
			metrics.throughput === null)
	) {
		notes.push(
			"No traffic in this source, so it is scored on default metrics.",
		);
	}
	if (entry.breakdown.uptimePenalty > 0) {
		notes.push(
			`Below ${context.uptimePenaltyThreshold}% uptime: exponential penalty ${signed(entry.breakdown.uptimePenalty)}.`,
		);
	}

	if (entry.providerId === best.providerId) {
		const others = rows.slice(1);
		if (others.length === 0) {
			return { headline: "Only routable mapping.", notes };
		}
		const leads = FACTORS.filter(
			(factor) =>
				factorWeight(factor, weights) > 0 &&
				entry.breakdown[factor.contribution] <= MIN_FACTOR_DELTA &&
				others.some(
					(other) =>
						other.breakdown[factor.contribution] -
							entry.breakdown[factor.contribution] >
						MIN_FACTOR_DELTA,
				),
		).map((factor) => factor.leadPhrase);
		const runnerUp = others[0];
		const margin = runnerUp.score - entry.score;
		if (margin <= context.stickyScoreMargin) {
			notes.push(
				`${context.providerName(runnerUp.providerId)} is within the ${context.stickyScoreMargin} sticky margin: an organization already pinned there keeps its traffic.`,
			);
		}
		return {
			headline:
				leads.length > 0
					? `Best score: ${joinPhrases(leads)}.`
					: "Best score, ahead on the sum rather than any single factor.",
			notes,
		};
	}

	const bestMetrics = metricsByProvider.get(best.providerId);
	const deltas = FACTORS.map((factor) => ({
		factor,
		delta:
			entry.breakdown[factor.contribution] -
			best.breakdown[factor.contribution],
	}));
	const describe = ({ factor, delta }: (typeof deltas)[number]) => {
		const detail = factorDetail(factor, entry, best, metrics, bestMetrics);
		return `${factor.label} ${signed(delta)}${detail ? ` (${detail})` : ""}`;
	};
	const behind = deltas
		.filter(({ delta }) => delta > MIN_FACTOR_DELTA)
		.sort((a, b) => b.delta - a.delta)
		.slice(0, MAX_LISTED_FACTORS)
		.map(describe);
	const ahead = deltas
		.filter(({ delta }) => delta < -MIN_FACTOR_DELTA)
		.sort((a, b) => a.delta - b.delta)
		.slice(0, MAX_LISTED_FACTORS)
		.map(describe);
	const uptimePenaltyDelta =
		entry.breakdown.uptimePenalty - best.breakdown.uptimePenalty;
	if (uptimePenaltyDelta > MIN_FACTOR_DELTA) {
		behind.push(`uptime penalty ${signed(uptimePenaltyDelta)}`);
	}

	const gap = entry.score - best.score;
	const parts = [`${signed(gap)} behind`];
	if (behind.length > 0) {
		parts.push(behind.join(", "));
	}
	if (ahead.length > 0) {
		parts.push(`ahead on ${ahead.join(", ")}`);
	}
	if (gap <= context.stickyScoreMargin) {
		notes.push(
			`Within the ${context.stickyScoreMargin} sticky margin: an organization already pinned here keeps its traffic.`,
		);
	}
	return { headline: parts.join(" · "), notes };
}
