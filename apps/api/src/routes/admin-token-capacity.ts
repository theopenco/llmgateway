import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";

import { db, excludeRegionalMappingRows, sql, tables } from "@llmgateway/db";
import { getProviderDefinition } from "@llmgateway/models";

import type { ServerTypes } from "@/vars.js";
import type { AnyColumn } from "@llmgateway/db";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const querySchema = z.object({
	window: z.enum(["24h", "7d", "30d"]).default("24h"),
	tokenType: z.enum(["total", "input", "cached", "output"]).default("total"),
	groupBy: z.enum(["model", "provider"]).default("model"),
	modelView: z.enum(["canonical", "mapping"]).default("canonical"),
	mode: z.enum(["total", "credits", "api-keys"]).default("total"),
});
type CapacityQuery = z.infer<typeof querySchema>;

// Input includes cached (cache-read) input; totals ignore the tokenType filter.
const splitSchema = z.object({
	inputTokens: z.number(),
	cachedTokens: z.number(),
	outputTokens: z.number(),
});
const metricsSchema = splitSchema.extend({
	totalTokens: z.number(),
	avgTpm: z.number(),
	peakTpm: z.number(),
	peakMinuteAt: z.string().nullable(),
	avgTokensPerDay: z.number(),
	peakTokensPerDay: z.number(),
	peakDayAt: z.string().nullable(),
});
const daySchema = splitSchema.extend({
	timestamp: z.string(),
	tokens: z.number(),
	partial: z.boolean(),
});
const responseSchema = querySchema.extend({
	start: z.string(),
	end: z.string(),
	asOf: z.string(),
	summary: metricsSchema,
	days: z.array(daySchema),
	// UTC hours; only populated for the 24h window.
	hours: z.array(daySchema),
	breakdown: z.array(
		metricsSchema.extend({ key: z.string(), label: z.string() }),
	),
});

interface TokenColumns {
	modelId: AnyColumn;
	providerId: AnyColumn;
	totalTokens: AnyColumn;
	totalInputTokens: AnyColumn;
	totalOutputTokens: AnyColumn;
	totalCachedTokens: AnyColumn;
}

function expressions(table: TokenColumns, query: CapacityQuery) {
	return {
		key:
			query.groupBy === "provider"
				? sql`${table.providerId}`
				: query.modelView === "canonical"
					? sql`${table.modelId}`
					: sql`${table.providerId} || '/' || ${table.modelId}`,
		tokens:
			query.tokenType === "input"
				? table.totalInputTokens
				: query.tokenType === "cached"
					? table.totalCachedTokens
					: query.tokenType === "output"
						? table.totalOutputTokens
						: table.totalTokens,
		split: sql`${table.totalInputTokens} AS input, ${table.totalCachedTokens} AS cached, ${table.totalOutputTokens} AS output`,
		hasTokens: sql`GREATEST(${table.totalTokens}, ${table.totalInputTokens}, ${table.totalOutputTokens}) > 0`,
	};
}

interface UsageRow extends Record<string, unknown> {
	key: string | null;
	timestamp: string;
	tokens: number;
}
interface SplitUsageRow extends UsageRow {
	input: number;
	cached: number;
	output: number;
}

/** Hourly totals plus minute edges cover exactly the completed-minute window. */
export function tokenCapacityUsageQuery(
	query: CapacityQuery,
	start: Date,
	end: Date,
	unit: "hour" | "day",
) {
	const hourly = tables.modelProviderMappingHistoryHourly;
	const minute = tables.modelProviderMappingHistory;
	const h = expressions(hourly, query);
	const m = expressions(minute, query);
	const trunc = sql.raw(`date_trunc('${unit}', ts)`);
	const firstHour = new Date(
		Math.ceil(start.getTime() / HOUR_MS) * HOUR_MS,
	).toISOString();
	const lastHour = new Date(
		Math.floor(end.getTime() / HOUR_MS) * HOUR_MS,
	).toISOString();
	return sql`
		WITH usage AS (
			SELECT ${h.key} AS key, ${hourly.hourTimestamp} AS ts, ${h.tokens} AS tokens, ${h.split}
			FROM ${hourly}
			WHERE ${hourly.hourTimestamp} >= ${firstHour}::timestamp
				AND ${hourly.hourTimestamp} < ${lastHour}::timestamp
				AND ${h.hasTokens}
				AND ${excludeRegionalMappingRows(hourly)}
				${query.mode === "total" ? sql`` : sql`AND ${hourly.usedMode} = ${query.mode}`}
			UNION ALL
			SELECT ${m.key} AS key, ${minute.minuteTimestamp} AS ts, ${m.tokens} AS tokens, ${m.split}
			FROM ${minute}
			WHERE ${minute.minuteTimestamp} >= ${start.toISOString()}::timestamp
				AND ${minute.minuteTimestamp} < ${end.toISOString()}::timestamp
				AND (${minute.minuteTimestamp} < ${firstHour}::timestamp
					OR ${minute.minuteTimestamp} >= ${lastHour}::timestamp)
				AND ${m.hasTokens}
				AND ${excludeRegionalMappingRows(minute)}
				${query.mode === "total" ? sql`` : sql`AND ${minute.usedMode} = ${query.mode}`}
		), bucketed AS (
			SELECT key, ${trunc} AS bucket, SUM(tokens)::float8 AS tokens,
				SUM(input)::float8 AS input, SUM(cached)::float8 AS cached,
				SUM(output)::float8 AS output
			FROM usage GROUP BY GROUPING SETS ((key, ${trunc}), (${trunc}))
		)
		SELECT key, to_char(bucket, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS timestamp,
			tokens, input, cached, output
		FROM bucketed
		ORDER BY bucket, key
	`;
}

/** Peaks must be taken after grouping simultaneous usage, never summed. */
export function tokenCapacityPeakQuery(
	query: CapacityQuery,
	start: Date,
	end: Date,
	keys: string[],
) {
	const minute = tables.modelProviderMappingHistory;
	const { key, tokens } = expressions(minute, query);
	const selectedKeys = keys.length
		? sql.join(
				keys.map((value) => sql`${value}`),
				sql`, `,
			)
		: sql`NULL`;
	return sql`
		WITH per_minute AS (
			SELECT ${key} AS key, ${minute.minuteTimestamp} AS ts, SUM(${tokens})::float8 AS tokens
			FROM ${minute}
			WHERE ${minute.minuteTimestamp} >= ${start.toISOString()}::timestamp
				AND ${minute.minuteTimestamp} < ${end.toISOString()}::timestamp
				AND ${tokens} > 0
				AND ${excludeRegionalMappingRows(minute)}
				${query.mode === "total" ? sql`` : sql`AND ${minute.usedMode} = ${query.mode}`}
			GROUP BY GROUPING SETS ((${minute.minuteTimestamp}, ${key}), (${minute.minuteTimestamp}))
			HAVING GROUPING(${key}) = 1 OR ${key} IN (${selectedKeys})
		)
		SELECT DISTINCT ON (key) key,
			to_char(ts, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS timestamp, tokens
		FROM per_minute ORDER BY key, tokens DESC, ts
	`;
}

export const adminTokenCapacity = new OpenAPIHono<ServerTypes>();

adminTokenCapacity.openapi(
	createRoute({
		method: "get",
		path: "/load/token-capacity",
		request: { query: querySchema },
		responses: {
			200: {
				description:
					"Observed token throughput and completed-minute/day peaks, retained for up to 30 days.",
				content: { "application/json": { schema: responseSchema } },
			},
		},
	}),
	async (c) => {
		const query = c.req.valid("query");
		const now = new Date();
		const windowMs =
			query.window === "24h"
				? DAY_MS
				: (query.window === "30d" ? 30 : 7) * DAY_MS;
		const unit = query.window === "24h" ? "hour" : "day";
		const start = new Date(
			Math.ceil((now.getTime() - windowMs) / MINUTE_MS) * MINUTE_MS,
		);
		const end = new Date(Math.floor(now.getTime() / MINUTE_MS) * MINUTE_MS);
		const elapsedMinutes = (end.getTime() - start.getTime()) / MINUTE_MS;
		const usage = (
			await db.execute<SplitUsageRow>(
				tokenCapacityUsageQuery(query, start, end, unit),
			)
		).rows;
		// Rows kept for the split may have none of the selected token type.
		const keys = [
			...new Set(
				usage.flatMap((row) =>
					row.key === null || !(Number(row.tokens) > 0) ? [] : [row.key],
				),
			),
		];
		const peaks = (
			await db.execute<UsageRow>(
				tokenCapacityPeakQuery(query, start, end, keys),
			)
		).rows;
		const peakByKey = new Map(peaks.map((row) => [row.key, row]));
		type Totals = z.infer<typeof splitSchema> & { tokens: number };
		const emptyTotals = (): Totals => ({
			tokens: 0,
			inputTokens: 0,
			cachedTokens: 0,
			outputTokens: 0,
		});
		type Buckets = Map<string | null, Map<string, Totals>>;
		const dailyByKey: Buckets = new Map();
		const hourlyByKey: Buckets = new Map();
		const add = (
			buckets: Buckets,
			key: string | null,
			timestamp: string,
			totals: Totals,
		) => {
			let values = buckets.get(key);
			if (!values) {
				values = new Map();
				buckets.set(key, values);
			}
			const current = values.get(timestamp) ?? emptyTotals();
			values.set(timestamp, {
				tokens: current.tokens + totals.tokens,
				inputTokens: current.inputTokens + totals.inputTokens,
				cachedTokens: current.cachedTokens + totals.cachedTokens,
				outputTokens: current.outputTokens + totals.outputTokens,
			});
		};
		for (const row of usage) {
			const tokens: Totals = {
				tokens: Number(row.tokens),
				inputTokens: Number(row.input),
				cachedTokens: Number(row.cached),
				outputTokens: Number(row.output),
			};
			add(
				dailyByKey,
				row.key,
				`${row.timestamp.slice(0, 10)}T00:00:00Z`,
				tokens,
			);
			if (unit === "hour") {
				add(hourlyByKey, row.key, row.timestamp, tokens);
			}
		}
		const gridFor = (size: number) => {
			const grid: { timestamp: string; partial: boolean }[] = [];
			for (
				let time = Math.floor(start.getTime() / size) * size;
				time < end.getTime();
				time += size
			) {
				grid.push({
					timestamp: new Date(time).toISOString().replace(".000Z", "Z"),
					partial: time < start.getTime() || time + size > end.getTime(),
				});
			}
			return grid;
		};
		const dayGrid = gridFor(DAY_MS);
		const hourGrid = unit === "hour" ? gridFor(HOUR_MS) : [];
		const seriesFor = (
			grid: { timestamp: string; partial: boolean }[],
			buckets: Buckets,
			key: string | null,
		) =>
			grid.map((bucket) => ({
				...bucket,
				...(buckets.get(key)?.get(bucket.timestamp) ?? emptyTotals()),
			}));
		const daysFor = (key: string | null) => seriesFor(dayGrid, dailyByKey, key);
		const metricsFor = (key: string | null) => {
			const values = daysFor(key);
			const totalTokens = values.reduce((sum, day) => sum + day.tokens, 0);
			const sum = (field: keyof z.infer<typeof splitSchema>) =>
				values.reduce((total, day) => total + day[field], 0);
			const peakDay = values
				.filter((day) => !day.partial)
				.reduce<(typeof values)[number] | null>(
					(best, day) => (!best || day.tokens > best.tokens ? day : best),
					null,
				);
			const peakMinute = peakByKey.get(key);
			return {
				totalTokens,
				inputTokens: sum("inputTokens"),
				cachedTokens: sum("cachedTokens"),
				outputTokens: sum("outputTokens"),
				avgTpm: totalTokens / elapsedMinutes,
				peakTpm: Number(peakMinute?.tokens ?? 0),
				peakMinuteAt:
					peakMinute && peakMinute.tokens > 0 ? peakMinute.timestamp : null,
				avgTokensPerDay: (totalTokens / elapsedMinutes) * 1440,
				peakTokensPerDay: peakDay?.tokens ?? 0,
				peakDayAt: peakDay && peakDay.tokens > 0 ? peakDay.timestamp : null,
			};
		};
		return c.json({
			...query,
			start: start.toISOString(),
			end: end.toISOString(),
			asOf: now.toISOString(),
			summary: metricsFor(null),
			days: daysFor(null),
			hours: seriesFor(hourGrid, hourlyByKey, null),
			breakdown: keys
				.map((key) => ({
					key,
					label:
						query.groupBy === "provider"
							? (getProviderDefinition(key)?.name ?? key)
							: key,
					...metricsFor(key),
				}))
				.sort(
					(a, b) => b.totalTokens - a.totalTokens || a.key.localeCompare(b.key),
				),
		});
	},
);
