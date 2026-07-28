import { sql } from "drizzle-orm";

import type { AnyColumn, SQL } from "drizzle-orm";

// Reasoning models stream thinking before any content, so their first content
// token only arrives after thinking finishes. Measuring TTFT on content alone
// would penalize mappings that stream reasoning. Wherever a
// first-reasoning-token time was recorded it is the real first-token latency;
// the content-token TTFT is the fallback for mappings that never stream
// reasoning (which correctly penalizes providers that think without
// streaming it).

interface TtftAggregateColumns {
	totalTimeToFirstToken: AnyColumn;
	timeToFirstTokenCount: AnyColumn;
	totalTimeToFirstReasoningToken: AnyColumn;
	timeToFirstReasoningTokenCount: AnyColumn;
}

/**
 * Average effective TTFT over aggregated history rows: prefers
 * reasoning-token samples when any exist in the aggregate, otherwise falls
 * back to content-token samples. Only streamed requests record either
 * metric, so each branch divides by its own sample count.
 */
export function avgEffectiveTtftSql(
	table: TtftAggregateColumns,
): SQL<number | null> {
	return sql<
		number | null
	>`CASE WHEN SUM(${table.timeToFirstReasoningTokenCount}) > 0 THEN SUM(${table.totalTimeToFirstReasoningToken})::float / SUM(${table.timeToFirstReasoningTokenCount}) WHEN SUM(${table.timeToFirstTokenCount}) > 0 THEN SUM(${table.totalTimeToFirstToken})::float / SUM(${table.timeToFirstTokenCount}) ELSE NULL END`;
}

export interface TtftTotals {
	totalTimeToFirstToken: number;
	timeToFirstTokenCount: number;
	totalTimeToFirstReasoningToken: number;
	timeToFirstReasoningTokenCount: number;
}

/**
 * Same preference applied to already-summed totals: returns the
 * reasoning-token sum/count pair when it has samples, else the content-token
 * pair.
 */
export function effectiveTtftTotals(totals: TtftTotals): {
	total: number;
	count: number;
} {
	if (totals.timeToFirstReasoningTokenCount > 0) {
		return {
			total: totals.totalTimeToFirstReasoningToken,
			count: totals.timeToFirstReasoningTokenCount,
		};
	}
	return {
		total: totals.totalTimeToFirstToken,
		count: totals.timeToFirstTokenCount,
	};
}

export function avgEffectiveTtft(totals: TtftTotals): number | null {
	const { total, count } = effectiveTtftTotals(totals);
	return count > 0 ? total / count : null;
}
