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
	window: z.enum(["7d", "30d"]).default("7d"),
	tokenType: z.enum(["total", "input", "output"]).default("total"),
	groupBy: z.enum(["model", "provider"]).default("model"),
	modelView: z.enum(["canonical", "mapping"]).default("canonical"),
	mode: z.enum(["total", "credits", "api-keys"]).default("total"),
});
type CapacityQuery = z.infer<typeof querySchema>;

const metricsSchema = z.object({
	totalTokens: z.number(),
	avgTpm: z.number(),
	peakTpm: z.number(),
	peakMinuteAt: z.string().nullable(),
	avgTokensPerDay: z.number(),
	peakTokensPerDay: z.number(),
	peakDayAt: z.string().nullable(),
});
const daySchema = z.object({
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
				: query.tokenType === "output"
					? table.totalOutputTokens
					: table.totalTokens,
	};
}

interface UsageRow extends Record<string, unknown> {
	key: string | null;
	timestamp: string;
	tokens: number;
}

/** Hourly totals plus minute edges cover exactly the completed-minute window. */
export function tokenCapacityDailyQuery(
	query: CapacityQuery,
	start: Date,
	end: Date,
) {
	const hourly = tables.modelProviderMappingHistoryHourly;
	const minute = tables.modelProviderMappingHistory;
	const h = expressions(hourly, query);
	const m = expressions(minute, query);
	const firstHour = new Date(
		Math.ceil(start.getTime() / HOUR_MS) * HOUR_MS,
	).toISOString();
	const lastHour = new Date(
		Math.floor(end.getTime() / HOUR_MS) * HOUR_MS,
	).toISOString();
	return sql`
		WITH usage AS (
			SELECT ${h.key} AS key, ${hourly.hourTimestamp} AS ts, ${h.tokens} AS tokens
			FROM ${hourly}
			WHERE ${hourly.hourTimestamp} >= ${firstHour}::timestamp
				AND ${hourly.hourTimestamp} < ${lastHour}::timestamp
				AND ${h.tokens} > 0
				AND ${excludeRegionalMappingRows(hourly)}
				${query.mode === "total" ? sql`` : sql`AND ${hourly.usedMode} = ${query.mode}`}
			UNION ALL
			SELECT ${m.key} AS key, ${minute.minuteTimestamp} AS ts, ${m.tokens} AS tokens
			FROM ${minute}
			WHERE ${minute.minuteTimestamp} >= ${start.toISOString()}::timestamp
				AND ${minute.minuteTimestamp} < ${end.toISOString()}::timestamp
				AND (${minute.minuteTimestamp} < ${firstHour}::timestamp
					OR ${minute.minuteTimestamp} >= ${lastHour}::timestamp)
				AND ${m.tokens} > 0
				AND ${excludeRegionalMappingRows(minute)}
				${query.mode === "total" ? sql`` : sql`AND ${minute.usedMode} = ${query.mode}`}
		), daily AS (
			SELECT key, date_trunc('day', ts) AS day, SUM(tokens)::float8 AS tokens
			FROM usage GROUP BY GROUPING SETS ((key, date_trunc('day', ts)), (date_trunc('day', ts)))
		)
		SELECT key, to_char(day, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS timestamp, tokens
		FROM daily
		ORDER BY day, key
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
		const days = query.window === "30d" ? 30 : 7;
		const windowMs = days * DAY_MS;
		const start = new Date(
			Math.ceil((now.getTime() - windowMs) / MINUTE_MS) * MINUTE_MS,
		);
		const end = new Date(Math.floor(now.getTime() / MINUTE_MS) * MINUTE_MS);
		const elapsedMinutes = (end.getTime() - start.getTime()) / MINUTE_MS;
		const daily = (
			await db.execute<UsageRow>(tokenCapacityDailyQuery(query, start, end))
		).rows;
		const keys = [
			...new Set(daily.flatMap((row) => (row.key === null ? [] : [row.key]))),
		];
		const peaks = (
			await db.execute<UsageRow>(
				tokenCapacityPeakQuery(query, start, end, keys),
			)
		).rows;
		const peakByKey = new Map(peaks.map((row) => [row.key, row]));
		const dailyByKey = new Map<string | null, Map<string, number>>();
		for (const row of daily) {
			let values = dailyByKey.get(row.key);
			if (!values) {
				values = new Map();
				dailyByKey.set(row.key, values);
			}
			values.set(row.timestamp, Number(row.tokens));
		}
		const grid: { timestamp: string; partial: boolean }[] = [];
		for (
			let time = Math.floor(start.getTime() / DAY_MS) * DAY_MS;
			time < end.getTime();
			time += DAY_MS
		) {
			grid.push({
				timestamp: new Date(time).toISOString().replace(".000Z", "Z"),
				partial: time < start.getTime() || time + DAY_MS > end.getTime(),
			});
		}
		const daysFor = (key: string | null) =>
			grid.map((day) => ({
				...day,
				tokens: dailyByKey.get(key)?.get(day.timestamp) ?? 0,
			}));
		const metricsFor = (key: string | null) => {
			const values = daysFor(key);
			const totalTokens = values.reduce((sum, day) => sum + day.tokens, 0);
			const peakDay = values
				.filter((day) => !day.partial)
				.reduce<(typeof values)[number] | null>(
					(best, day) => (!best || day.tokens > best.tokens ? day : best),
					null,
				);
			const peakMinute = peakByKey.get(key);
			return {
				totalTokens,
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
