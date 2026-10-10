/**
 * A narrow read-only view of the `BenchmarkResult` the worker stores as jsonb.
 * The admin app deliberately does not import `@llmgateway/benchmarks`: the
 * suites pull in `node:vm`, which cannot be bundled for the browser.
 */

export interface BenchmarkNumericSummary {
	p50: number;
	p90: number;
	mean: number;
}

export interface BenchmarkTargetView {
	targetId: string;
	displayName: string;
	successRate: number | null;
	qualityPassed: number;
	qualityAttempted: number;
	qualityScore: number | null;
	ttftP50: number | null;
	totalP50: number | null;
	tokensPerSecondP50: number | null;
	costPerCorrectUsd: number | null;
	totalCostUsd: number | null;
	agent: BenchmarkAgentView | null;
}

export interface BenchmarkAgentView {
	solved: number;
	attempted: number;
	solveRate: number | null;
	turnsP50: number | null;
	toolCallsP50: number | null;
	invalidToolCallRate: number | null;
	repeatedToolCallRate: number | null;
	wallClockP50: number | null;
	costPerSolvedTaskUsd: number | null;
	stopReasons: Record<string, number>;
}

function record(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function numberOrNull(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function quantile(value: unknown, field: "p50" | "p90" = "p50"): number | null {
	return numberOrNull(record(value)?.[field]);
}

function agentView(value: unknown): BenchmarkAgentView | null {
	const agent = record(value);
	if (!agent) {
		return null;
	}
	const stopReasons = record(agent.stopReasons) ?? {};
	return {
		solved: numberOrNull(agent.solved) ?? 0,
		attempted: numberOrNull(agent.attempted) ?? 0,
		solveRate: numberOrNull(agent.solveRate),
		turnsP50: quantile(agent.turns),
		toolCallsP50: quantile(agent.toolCalls),
		invalidToolCallRate: numberOrNull(agent.invalidToolCallRate),
		repeatedToolCallRate: numberOrNull(agent.repeatedToolCallRate),
		wallClockP50: quantile(agent.wallClockMs),
		costPerSolvedTaskUsd: numberOrNull(agent.costPerSolvedTaskUsd),
		stopReasons: Object.fromEntries(
			Object.entries(stopReasons).flatMap(([reason, count]) => {
				const parsed = numberOrNull(count);
				return parsed === null ? [] : [[reason, parsed] as const];
			}),
		),
	};
}

export function parseBenchmarkTargets(
	result: Record<string, unknown> | null,
): BenchmarkTargetView[] {
	const summary = record(result?.summary);
	const targets = summary?.targets;
	const displayNames = new Map<string, string>();
	for (const target of Array.isArray(result?.targets) ? result.targets : []) {
		const entry = record(target);
		if (typeof entry?.id === "string") {
			displayNames.set(
				entry.id,
				typeof entry.displayName === "string" ? entry.displayName : entry.id,
			);
		}
	}
	if (!Array.isArray(targets)) {
		return [];
	}
	return targets.flatMap((value) => {
		const target = record(value);
		const targetId = target?.targetId;
		if (typeof targetId !== "string") {
			return [];
		}
		const quality = record(target?.quality);
		const performance = record(target?.performance);
		const reliability = record(target?.reliability);
		const efficiency = record(target?.efficiency);
		return [
			{
				targetId,
				displayName: displayNames.get(targetId) ?? targetId,
				successRate: numberOrNull(reliability?.successRate),
				qualityPassed: numberOrNull(quality?.passed) ?? 0,
				qualityAttempted: numberOrNull(quality?.attempted) ?? 0,
				qualityScore: numberOrNull(quality?.score),
				ttftP50: quantile(performance?.ttftMs),
				totalP50: quantile(performance?.totalMs),
				tokensPerSecondP50: quantile(performance?.visibleTokensPerSecond),
				costPerCorrectUsd: numberOrNull(efficiency?.costPerCorrectAnswerUsd),
				totalCostUsd: numberOrNull(efficiency?.estimatedCostUsd),
				agent: agentView(target?.agent),
			},
		];
	});
}

export function formatPercent(value: number | null): string {
	return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

export function formatNumber(value: number | null, digits = 1): string {
	return value === null ? "—" : value.toFixed(digits);
}

export function formatUsd(value: number | null): string {
	return value === null ? "—" : `$${value.toPrecision(4)}`;
}
