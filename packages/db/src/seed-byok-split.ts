import { db, sql, tables } from "./index.js";

import type { AnyColumn } from "drizzle-orm";

/**
 * Fills the BYOK error and latency subsets of the seeded tenant stats from
 * each row's own BYOK request share, so the admin Gateway Load mode filter
 * has data on every axis without each seed computing the split by hand.
 */
export async function seedByokSplit(): Promise<void> {
	for (const table of [
		tables.projectHourlyStats,
		tables.projectHourlyModelStats,
		tables.apiKeyHourlyStats,
		tables.apiKeyHourlyModelStats,
	]) {
		const share = (column: AnyColumn) =>
			sql`floor(${column}::numeric * ${table.apiKeysRequestCount} / ${table.requestCount})`;
		await db
			.update(table)
			.set({
				apiKeysClientErrorCount: share(table.clientErrorCount),
				apiKeysGatewayErrorCount: share(table.gatewayErrorCount),
				apiKeysUpstreamErrorCount: share(table.upstreamErrorCount),
				apiKeysTotalDuration: share(table.totalDuration),
				apiKeysDurationCount: share(table.durationCount),
				apiKeysTotalTimeToFirstToken: share(table.totalTimeToFirstToken),
				apiKeysTimeToFirstTokenCount: share(table.timeToFirstTokenCount),
				apiKeysTotalTimeToFirstReasoningToken: share(
					table.totalTimeToFirstReasoningToken,
				),
				apiKeysTimeToFirstReasoningTokenCount: share(
					table.timeToFirstReasoningTokenCount,
				),
			})
			.where(sql`${table.requestCount} > 0`);
	}
}
