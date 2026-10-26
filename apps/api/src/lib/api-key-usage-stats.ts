import { and, apiKeyHourlyStats, db, gte, inArray, sql } from "@llmgateway/db";

export const apiKeyUsagePeriods = ["24h", "7d", "30d", "90d", "all"] as const;

export type ApiKeyUsagePeriod = (typeof apiKeyUsagePeriods)[number];

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const periodDurationMs: Record<Exclude<ApiKeyUsagePeriod, "all">, number> = {
	"24h": DAY_MS,
	"7d": 7 * DAY_MS,
	"30d": 30 * DAY_MS,
	"90d": 90 * DAY_MS,
};

/** Start of the first hourly bucket inside the period, or null for all time. */
export function apiKeyUsagePeriodStart(
	period: ApiKeyUsagePeriod,
	now: Date = new Date(),
): Date | null {
	if (period === "all") {
		return null;
	}
	const start = now.getTime() - periodDurationMs[period];
	return new Date(start - (start % HOUR_MS));
}

export interface ApiKeyUsageStats {
	/** Spend inside the period; null for all time (callers use apiKey.usage). */
	periodUsage: string | null;
	/** Requests inside the period; null for all time. */
	periodRequestCount: number | null;
	/** Start of the latest hour with at least one request. */
	lastUsedAt: Date | null;
}

/**
 * Period spend and last-used hour per key, read from api_key_hourly_stats so
 * the dashboard never scans `log`.
 */
export async function getApiKeyUsageStats(
	apiKeyIds: string[],
	period: ApiKeyUsagePeriod,
	now: Date = new Date(),
): Promise<Map<string, ApiKeyUsageStats>> {
	const stats = new Map<string, ApiKeyUsageStats>();
	if (!apiKeyIds.length) {
		return stats;
	}

	const periodStart = apiKeyUsagePeriodStart(period, now);

	const [periodRows, lastUsedRows] = await Promise.all([
		periodStart
			? db
					.select({
						apiKeyId: apiKeyHourlyStats.apiKeyId,
						cost: sql<string>`COALESCE(SUM(CAST(${apiKeyHourlyStats.cost} AS DOUBLE PRECISION)), 0)::text`,
						requestCount: sql<number>`COALESCE(SUM(${apiKeyHourlyStats.requestCount}), 0)::int`,
					})
					.from(apiKeyHourlyStats)
					.where(
						and(
							inArray(apiKeyHourlyStats.apiKeyId, apiKeyIds),
							gte(apiKeyHourlyStats.hourTimestamp, periodStart),
						),
					)
					.groupBy(apiKeyHourlyStats.apiKeyId)
			: Promise.resolve([]),
		// One index probe per key on (api_key_id, hour_timestamp), newest first.
		// hour_timestamp is a UTC timestamp without time zone, so serialize it with
		// an explicit Z instead of letting the driver parse it as local time.
		db.execute<{ api_key_id: string; last_used_at: string | null }>(
			sql`SELECT k.id AS api_key_id, (
				SELECT to_char(s.hour_timestamp, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
				FROM api_key_hourly_stats s
				WHERE s.api_key_id = k.id AND s.request_count > 0
				ORDER BY s.hour_timestamp DESC LIMIT 1
			) AS last_used_at
			FROM unnest(ARRAY[${sql.join(
				apiKeyIds.map((id) => sql`${id}`),
				sql`, `,
			)}]::text[]) AS k(id)`,
		),
	]);

	const periodByKey = new Map(periodRows.map((row) => [row.apiKeyId, row]));

	for (const row of lastUsedRows.rows) {
		const periodRow = periodByKey.get(row.api_key_id);
		stats.set(row.api_key_id, {
			periodUsage: periodStart ? (periodRow?.cost ?? "0") : null,
			periodRequestCount: periodStart
				? Number(periodRow?.requestCount ?? 0)
				: null,
			lastUsedAt: row.last_used_at ? new Date(row.last_used_at) : null,
		});
	}

	return stats;
}
