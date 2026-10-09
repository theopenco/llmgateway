import { Decimal } from "decimal.js";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { eachDay } from "@/lib/date-range.js";
import { modeSplitFields } from "@/lib/mode-split.js";
import { formatInTimeZone, zonedTimeToUtc } from "@/utils/timezone.js";

import {
	and,
	apiKeyHourlyModelStats,
	db,
	eq,
	gte,
	inArray,
	lte,
	projectHourlyModelStats,
	sql,
	tables,
} from "@llmgateway/db";

import type {
	UsageCounts,
	UsageGroup,
	UsageSeries,
	UsageTimeseries,
} from "@llmgateway/shared/prompt-cache";

const countsSchema = z.object({
	cost: z.number(),
	requestCount: z.number(),
	totalTokens: z.number(),
	inputTokens: z.number(),
	cachedTokens: z.number(),
	creditsCost: z.number(),
	apiKeysCost: z.number(),
	creditsRequestCount: z.number(),
	apiKeysRequestCount: z.number(),
});
const optionSchema = z.object({ key: z.string(), label: z.string() });
export const organizationTimeseriesSchema = z.object({
	bucket: z.enum(["hour", "day"]),
	series: z.array(optionSchema),
	points: z.array(
		z.object({
			timestamp: z.string(),
			incomplete: z.boolean(),
			totals: countsSchema,
			entries: z.array(
				countsSchema.extend({ key: z.string(), label: z.string() }),
			),
		}),
	),
	filters: z.object({
		models: z.array(optionSchema),
		apiKeys: z.array(optionSchema),
	}),
});
export const organizationTimeseriesQuery = {
	includeTimeseries: z.enum(["true", "false"]).optional(),
	mode: z.enum(["total", "credits", "api-keys"]).optional(),
	model: z.string().max(300).optional(),
	apiKeyId: z.string().max(100).optional(),
	rankBy: z
		.enum(["cost", "requestCount", "totalTokens", "inputTokens"])
		.optional(),
};
const MAX_RANGE_MS = 366 * 86_400_000;
const MAX_HOURLY_RANGE_MS = 30 * 86_400_000;
const DST_HOUR_MS = 3_600_000;

const emptyCounts = (): UsageCounts => ({
	cost: 0,
	requestCount: 0,
	totalTokens: 0,
	inputTokens: 0,
	cachedTokens: 0,
	creditsCost: 0,
	apiKeysCost: 0,
	creditsRequestCount: 0,
	apiKeysRequestCount: 0,
});
const countKeys = Object.keys(emptyCounts()) as (keyof UsageCounts)[];
function addCounts(target: UsageCounts, source: UsageCounts) {
	for (const key of countKeys) {
		target[key] =
			key.endsWith("Cost") || key === "cost"
				? new Decimal(target[key]).add(source[key]).toNumber()
				: target[key] + source[key];
	}
}

export async function getOrganizationTimeseries({
	projectIds,
	startDate,
	endDate,
	bucket,
	groupBy,
	modelView = "canonical",
	timeZone = "UTC",
	model,
	apiKeyId,
	rankBy = "cost",
	mode = "total",
	now = new Date(),
}: {
	projectIds: string[];
	startDate: Date;
	endDate: Date;
	bucket: "hour" | "day";
	groupBy: UsageGroup;
	modelView?: "canonical" | "mapping";
	timeZone?: string;
	model?: string;
	apiKeyId?: string;
	rankBy?: "cost" | "requestCount" | "totalTokens" | "inputTokens";
	now?: Date;
	mode?: "total" | "credits" | "api-keys";
}): Promise<UsageTimeseries> {
	if (
		endDate < startDate ||
		endDate.getTime() - startDate.getTime() > MAX_RANGE_MS + DST_HOUR_MS
	) {
		throw new HTTPException(400, {
			message: "Invalid time range (max 366 days)",
		});
	}
	if (
		bucket === "hour" &&
		endDate.getTime() - startDate.getTime() > MAX_HOURLY_RANGE_MS + DST_HOUR_MS
	) {
		throw new HTTPException(400, {
			message: "Hourly buckets require a range of at most 30 days",
		});
	}
	// Use the same source hours at both resolutions, including fractional-offset zones.
	const start = new Date(
		Math.ceil(startDate.getTime() / 3_600_000) * 3_600_000,
	);
	const range = (
		table: typeof projectHourlyModelStats | typeof apiKeyHourlyModelStats,
	) =>
		and(
			inArray(table.projectId, projectIds),
			gte(table.hourTimestamp, start),
			lte(table.hourTimestamp, endDate),
		);
	const canonical = (
		table: typeof projectHourlyModelStats | typeof apiKeyHourlyModelStats,
	) =>
		modelView === "mapping"
			? sql<string>`${table.usedModel}`
			: sql<string>`split_part(regexp_replace(${table.usedModel}, '^[^/]+/', ''), ':', 1)`;
	const timestamp = (
		table: typeof projectHourlyModelStats | typeof apiKeyHourlyModelStats,
	) =>
		bucket === "hour"
			? sql<string>`to_char(${table.hourTimestamp}, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`
			: sql<string>`to_char(${table.hourTimestamp} AT TIME ZONE 'UTC' AT TIME ZONE ${timeZone}, 'YYYY-MM-DD')`;
	const modelOptions = projectIds.length
		? await db
				.select({ key: canonical(projectHourlyModelStats) })
				.from(projectHourlyModelStats)
				.where(range(projectHourlyModelStats))
				.groupBy(sql`1`)
				.orderBy(sql`1`)
		: [];
	const keyOptions = projectIds.length
		? await db
				.select({
					key: apiKeyHourlyModelStats.apiKeyId,
					name: tables.apiKey.description,
					project: tables.project.name,
				})
				.from(apiKeyHourlyModelStats)
				.leftJoin(
					tables.apiKey,
					eq(tables.apiKey.id, apiKeyHourlyModelStats.apiKeyId),
				)
				.innerJoin(
					tables.project,
					eq(tables.project.id, apiKeyHourlyModelStats.projectId),
				)
				.where(range(apiKeyHourlyModelStats))
				.groupBy(sql`1, 2, 3`)
				.orderBy(sql`1`)
		: [];
	if (apiKeyId) {
		const key = await db.query.apiKey.findFirst({
			where: { id: { eq: apiKeyId }, projectId: { in: projectIds } },
			columns: { id: true },
		});
		if (!key && !keyOptions.some((entry) => entry.key === apiKeyId)) {
			throw new HTTPException(404, {
				message: "API key not found in this organization",
			});
		}
	}
	const filters = {
		models: modelOptions.map(({ key }) => ({ key, label: key })),
		apiKeys: keyOptions.map(({ key, name, project }) => ({
			key,
			label: `${name ?? "Deleted key"} · ${project ?? "Project"} · ${key.slice(-6)}`,
		})),
	};
	const needsKeys = !!apiKeyId || groupBy === "apiKey" || groupBy === "user";
	const table = needsKeys ? apiKeyHourlyModelStats : projectHourlyModelStats;
	const dimension =
		groupBy === "model"
			? canonical(table)
			: groupBy === "project"
				? sql<string>`${table.projectId}`
				: groupBy === "apiKey"
					? sql<string>`${apiKeyHourlyModelStats.apiKeyId}`
					: sql<string>`coalesce(${tables.user.id}, '__unattributed__')`;
	const label =
		groupBy === "model"
			? canonical(table)
			: groupBy === "project"
				? sql<string>`${tables.project.name}`
				: groupBy === "apiKey"
					? sql<string>`coalesce(${tables.apiKey.description}, 'Deleted key') || ' · ' || ${tables.project.name} || ' · ' || right(${apiKeyHourlyModelStats.apiKeyId}, 6)`
					: sql<string>`coalesce(${tables.user.name}, 'Unattributed')`;
	const sums = (
		table: typeof projectHourlyModelStats | typeof apiKeyHourlyModelStats,
	) => ({
		cost: sql<number>`sum(cast(${table.cost} as double precision))`,
		requestCount: sql<number>`sum(${table.requestCount})`,
		totalTokens: sql<number>`sum(${table.totalTokens}::numeric)`,
		inputTokens: sql<number>`sum(${table.inputTokens}::numeric)`,
		cachedTokens: sql<number>`sum(${table.cachedTokens}::numeric)`,
		...modeSplitFields(table),
	});
	const rows = projectIds.length
		? await db
				.select({
					timestamp: timestamp(table).as("timestamp"),
					key: dimension.as("key"),
					label: label.as("label"),
					...sums(table),
				})
				.from(table)
				.innerJoin(tables.project, eq(tables.project.id, table.projectId))
				.leftJoin(
					tables.apiKey,
					needsKeys
						? eq(tables.apiKey.id, apiKeyHourlyModelStats.apiKeyId)
						: sql`false`,
				)
				.leftJoin(tables.user, eq(tables.user.id, tables.apiKey.createdBy))
				.where(
					and(
						range(table),
						model ? sql`${canonical(table)} = ${model}` : undefined,
						apiKeyId
							? eq(apiKeyHourlyModelStats.apiKeyId, apiKeyId)
							: undefined,
					),
				)
				.groupBy(sql`1, 2, 3`)
				.orderBy(sql`1, 2`)
		: [];
	const byTime = new Map<string, UsageSeries[]>();
	const ranked = new Map<string, UsageSeries>();
	for (const row of rows) {
		const entry: UsageSeries = {
			key: row.key,
			label: row.label,
			...emptyCounts(),
		};
		for (const key of countKeys) {
			entry[key] = Number(row[key]);
		}
		const entries = byTime.get(row.timestamp) ?? [];
		entries.push(entry);
		byTime.set(row.timestamp, entries);
		const total = ranked.get(entry.key) ?? {
			key: entry.key,
			label: entry.label,
			...emptyCounts(),
		};
		addCounts(total, entry);
		ranked.set(entry.key, total);
	}
	if (needsKeys && !apiKeyId && projectIds.length) {
		// Key rollups omit platform traffic; retain it as an explicit residual.
		const totals = await db
			.select({
				timestamp: timestamp(projectHourlyModelStats).as("timestamp"),
				...sums(projectHourlyModelStats),
			})
			.from(projectHourlyModelStats)
			.where(
				and(
					range(projectHourlyModelStats),
					model
						? sql`${canonical(projectHourlyModelStats)} = ${model}`
						: undefined,
				),
			)
			.groupBy(sql`1`);
		for (const row of totals) {
			const entries = byTime.get(row.timestamp) ?? [];
			const accounted = emptyCounts();
			entries.forEach((entry) => addCounts(accounted, entry));
			const residual: UsageSeries = {
				key: "__unattributed__",
				label: "Unattributed",
				...emptyCounts(),
			};
			for (const key of countKeys) {
				residual[key] = Math.max(
					0,
					new Decimal(Number(row[key])).sub(accounted[key]).toNumber(),
				);
			}
			if (
				residual.requestCount > 0 ||
				residual.inputTokens > 0 ||
				residual.totalTokens > 0 ||
				residual.cost > 1e-9
			) {
				const existing = entries.find((entry) => entry.key === residual.key);
				if (existing) {
					addCounts(existing, residual);
				} else {
					entries.push(residual);
				}
				byTime.set(row.timestamp, entries);
				const total = ranked.get(residual.key) ?? {
					...emptyCounts(),
					key: residual.key,
					label: residual.label,
				};
				addCounts(total, residual);
				ranked.set(residual.key, total);
			}
		}
	}
	const rankMetric =
		mode === "total"
			? rankBy
			: rankBy === "cost"
				? mode === "credits"
					? "creditsCost"
					: "apiKeysCost"
				: rankBy === "requestCount"
					? mode === "credits"
						? "creditsRequestCount"
						: "apiKeysRequestCount"
					: rankBy;
	const series = [...ranked.values()]
		.sort((a, b) => b[rankMetric] - a[rankMetric] || a.key.localeCompare(b.key))
		.slice(0, 10)
		.map(({ key, label }) => ({ key, label }));
	const selected = new Set(series.map((s) => s.key));
	const timestamps: string[] = [];
	if (bucket === "hour") {
		for (let ms = start.getTime(); ms <= endDate.getTime(); ms += 3_600_000) {
			timestamps.push(new Date(ms).toISOString().replace(".000Z", "Z"));
		}
	} else {
		timestamps.push(
			...eachDay(
				formatInTimeZone(startDate, timeZone, false),
				formatInTimeZone(endDate, timeZone, false),
			),
		);
	}
	const currentBucket =
		bucket === "hour"
			? new Date(now).toISOString().slice(0, 13)
			: formatInTimeZone(now, timeZone, false);
	return {
		bucket,
		series,
		filters,
		points: timestamps.map((timestamp) => {
			const entries = byTime.get(timestamp) ?? [];
			const totals = emptyCounts();
			entries.forEach((entry) => addCounts(totals, entry));
			return {
				timestamp:
					bucket === "hour"
						? timestamp
						: zonedTimeToUtc(`${timestamp}T00:00:00`, timeZone).toISOString(),
				incomplete:
					bucket === "hour"
						? timestamp.slice(0, 13) === currentBucket
						: timestamp === currentBucket,
				totals,
				entries: entries.filter((entry) => selected.has(entry.key)),
			};
		}),
	};
}
