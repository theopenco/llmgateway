import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";

import {
	BUCKET_SECONDS,
	bucketSecondsFor,
	generateLoadBuckets,
	getLoadBucketForWindow,
	isPartialBucket,
	loadBucketSchema,
	toRps,
	truncateToLoadBucket,
	type LoadBucket,
} from "@/lib/load-buckets.js";
import {
	getTokenWindowStartDate,
	tokenWindowSchema,
} from "@/lib/stats-window.js";
import { adminMiddleware } from "@/middleware/admin.js";
import { pickMappingHistoryTable } from "@/utils/history-window.js";

import {
	and,
	asc,
	avgEffectiveTtft,
	db,
	desc,
	eq,
	excludeRegionalMappingRows,
	gte,
	ilike,
	inArray,
	or,
	sql,
	tables,
} from "@llmgateway/db";
import { getProviderDefinition } from "@llmgateway/models";

import type { ServerTypes } from "@/vars.js";
import type { AnyColumn, SQL, TtftTotals } from "@llmgateway/db";

export const adminLoad = new OpenAPIHono<ServerTypes>();

adminLoad.use("/*", adminMiddleware);

// Enough series to show who the heavy hitters are without turning the chart
// into spaghetti; the rest is folded into a single "Other" band.
const TOP_LOAD_SERIES = 10;

/**
 * How many settled buckets the headline "current" rate averages over.
 *
 * Gateway traffic arrives in bursts, so a single minute is often empty even
 * while the platform is busy — reading the last minute alone makes the tile
 * flicker to zero. Five minutes smooths that out. Hour and day buckets are
 * already averages, so they use the last one as-is.
 */
const CURRENT_RATE_BUCKETS: Record<LoadBucket, number> = {
	minute: 5,
	hour: 1,
	day: 1,
};

const loadGroupBySchema = z.enum([
	"model",
	"provider",
	"organization",
	"project",
	"api-key",
]);
const loadModelViewSchema = z.enum(["mapping", "canonical"]);
const loadModeSchema = z.enum(["total", "credits", "api-keys"]);

/**
 * Which rollup family answered the request.
 *
 * `mapping-history` is the model/provider axis: minute-grain rows the worker
 * rewrites every few seconds, so the rate is genuinely live. `project-stats`
 * is the tenant axis (organization/project/API key), which only exists at
 * hourly grain — the rate there is an hourly average, with the in-progress
 * hour pro-rated over its elapsed seconds.
 */
const loadSourceSchema = z.enum(["mapping-history", "project-stats"]);

type LoadGroupBy = z.infer<typeof loadGroupBySchema>;
type LoadMode = z.infer<typeof loadModeSchema>;

interface LoadScope {
	window: z.infer<typeof tokenWindowSchema>;
	bucket: LoadBucket;
	source: z.infer<typeof loadSourceSchema>;
	groupBy: LoadGroupBy;
	modelView: z.infer<typeof loadModelViewSchema>;
	mode: LoadMode;
	organizationId?: string;
	projectId?: string;
	apiKeyId?: string;
	startDate: Date;
	now: Date;
}

interface LoadQuery {
	window?: z.infer<typeof tokenWindowSchema>;
	bucket?: LoadBucket;
	groupBy?: LoadGroupBy;
	modelView?: z.infer<typeof loadModelViewSchema>;
	mode?: LoadMode;
	organizationId?: string;
	projectId?: string;
	apiKeyId?: string;
}

function resolveLoadScope(query: LoadQuery, now: Date = new Date()): LoadScope {
	const window = query.window ?? "1h";
	const groupBy = query.groupBy ?? "model";
	const tenantFiltered = Boolean(
		query.organizationId || query.projectId || query.apiKeyId,
	);
	const catalogAxis = groupBy === "model" || groupBy === "provider";
	const source =
		catalogAxis && !tenantFiltered ? "mapping-history" : "project-stats";

	let bucket = query.bucket ?? getLoadBucketForWindow(window);
	// The tenant rollups have no sub-hour grain, so honouring a minute request
	// there would label hourly rows as minutes and inflate every rate 60x.
	if (source === "project-stats" && bucket === "minute") {
		bucket = "hour";
	}

	return {
		window,
		bucket,
		source,
		groupBy,
		modelView: query.modelView ?? "canonical",
		mode: query.mode ?? "total",
		organizationId: query.organizationId,
		projectId: query.projectId,
		apiKeyId: query.apiKeyId,
		startDate: getTokenWindowStartDate(window, now),
		now,
	};
}

/**
 * Start of the range the SQL filters use.
 *
 * Rollup rows are stamped with the floor of their bucket, and the zero-fill
 * grid starts at the floor of the window too. Filtering on the raw window start
 * would therefore exclude the row for the very first bucket the chart draws, so
 * every view would open on a permanent zero — and `avgRps`, which counts that
 * bucket's seconds in full, would be dragged down with it.
 */
function loadRangeStart(scope: LoadScope): Date {
	return truncateToLoadBucket(scope.startDate, scope.bucket);
}

function bucketExpression(column: AnyColumn, unit: LoadBucket) {
	// `unit` comes from a zod enum, so the raw interpolation cannot carry input.
	return sql<string>`to_char(date_trunc(${sql.raw(`'${unit}'`)}, ${column}), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;
}

/**
 * `used_model` is stored as `provider/model[:region]`; the canonical catalogue
 * id is the segment between the first `/` and the optional `:`. Collapsing in
 * SQL rather than in TypeScript keeps the grouping key identical across the
 * ranking query and the per-bucket query that filters on it.
 */
function canonicalModelExpression(column: AnyColumn) {
	return sql<string>`split_part(case when position('/' in ${column}) > 0 then split_part(${column}, '/', 2) else ${column} end, ':', 1)`;
}

/**
 * Latency is carried as sums plus their own sample counts all the way to the
 * response, so every rollup step stays count-weighted. Averaging per-bucket
 * averages would let a minute with three requests outweigh one with thousands.
 *
 * The TTFT members are exactly `TtftTotals`, so `avgEffectiveTtft` applies to
 * both sources unchanged and the page cannot report one definition of TTFT on
 * the model axis and another on the organization axis.
 */
interface LatencyTotals extends TtftTotals {
	totalDuration: number;
	durationCount: number;
}

interface BucketTotalRow extends LatencyTotals {
	bucket: string;
	requestCount: number;
	errorCount: number;
}

interface KeyTotalRow extends LatencyTotals {
	key: string;
	requestCount: number;
	errorCount: number;
}

interface KeyBucketRow extends LatencyTotals {
	bucket: string;
	key: string;
	requestCount: number;
}

function emptyLatency(): LatencyTotals {
	return {
		totalDuration: 0,
		durationCount: 0,
		totalTimeToFirstToken: 0,
		timeToFirstTokenCount: 0,
		totalTimeToFirstReasoningToken: 0,
		timeToFirstReasoningTokenCount: 0,
	};
}

function addLatency(into: LatencyTotals, from: LatencyTotals): void {
	into.totalDuration += from.totalDuration;
	into.durationCount += from.durationCount;
	into.totalTimeToFirstToken += from.totalTimeToFirstToken;
	into.timeToFirstTokenCount += from.timeToFirstTokenCount;
	into.totalTimeToFirstReasoningToken += from.totalTimeToFirstReasoningToken;
	into.timeToFirstReasoningTokenCount += from.timeToFirstReasoningTokenCount;
}

/**
 * `SUM(bigint)` comes back as `numeric`, which the driver hands over as a
 * string, so every sum is cast to float8 — a millisecond total tops out far
 * inside float8's exact-integer range.
 */
function latencySums(table: {
	totalDuration: AnyColumn;
	durationCount: AnyColumn;
	totalTimeToFirstToken: AnyColumn;
	timeToFirstTokenCount: AnyColumn;
	totalTimeToFirstReasoningToken: AnyColumn;
	timeToFirstReasoningTokenCount: AnyColumn;
}) {
	return {
		totalDuration:
			sql<number>`COALESCE(SUM(${table.totalDuration}), 0)::float8`.as(
				"total_duration",
			),
		durationCount:
			sql<number>`COALESCE(SUM(${table.durationCount}), 0)::float8`.as(
				"duration_count",
			),
		totalTimeToFirstToken:
			sql<number>`COALESCE(SUM(${table.totalTimeToFirstToken}), 0)::float8`.as(
				"total_ttft",
			),
		timeToFirstTokenCount:
			sql<number>`COALESCE(SUM(${table.timeToFirstTokenCount}), 0)::float8`.as(
				"ttft_count",
			),
		totalTimeToFirstReasoningToken:
			sql<number>`COALESCE(SUM(${table.totalTimeToFirstReasoningToken}), 0)::float8`.as(
				"total_ttfrt",
			),
		timeToFirstReasoningTokenCount:
			sql<number>`COALESCE(SUM(${table.timeToFirstReasoningTokenCount}), 0)::float8`.as(
				"ttfrt_count",
			),
	};
}

function readLatency(row: LatencyTotals): LatencyTotals {
	return {
		totalDuration: Number(row.totalDuration),
		durationCount: Number(row.durationCount),
		totalTimeToFirstToken: Number(row.totalTimeToFirstToken),
		timeToFirstTokenCount: Number(row.timeToFirstTokenCount),
		totalTimeToFirstReasoningToken: Number(row.totalTimeToFirstReasoningToken),
		timeToFirstReasoningTokenCount: Number(row.timeToFirstReasoningTokenCount),
	};
}

/**
 * The three shapes every load view needs. They are separate queries on purpose:
 * one combined `GROUP BY bucket, key` would return `keys x buckets` rows, which
 * for a cross-tenant organization ranking over 90 days is six figures of rows
 * per poll. Ranking first and only bucketing the top series keeps every result
 * set bounded.
 */
interface LoadSource {
	bucketTotals: () => Promise<BucketTotalRow[]>;
	keyTotals: () => Promise<KeyTotalRow[]>;
	keyBuckets: (keys: string[]) => Promise<KeyBucketRow[]>;
}

function mappingHistorySource(scope: LoadScope): LoadSource {
	const { table: mph, bucket: mphTs } = pickMappingHistoryTable(
		scope.bucket !== "minute",
	);
	const rangeStart = loadRangeStart(scope);

	const keyExpr =
		scope.groupBy === "provider"
			? sql<string>`${mph.providerId}`
			: scope.modelView === "canonical"
				? sql<string>`${mph.modelId}`
				: sql<string>`${mph.providerId} || '/' || ${mph.modelId}`;

	const filters = [
		gte(mphTs, rangeStart),
		// Regional rows are already merged into their region-less root row, so
		// summing both double-counts a provider whose traffic is all regional.
		excludeRegionalMappingRows(mph),
	];
	if (scope.mode !== "total") {
		filters.push(eq(mph.usedMode, scope.mode));
	}

	const bucketExpr = bucketExpression(mphTs, scope.bucket);
	const requests = sql<number>`COALESCE(SUM(${mph.logsCount}), 0)::float8`;
	const errors = sql<number>`COALESCE(SUM(${mph.errorsCount}), 0)::float8`;
	// The mapping history has no dedicated duration sample count — every logged
	// request contributes one — so `logsCount` is the denominator, which is also
	// what the model history endpoints divide by.
	const latency = latencySums({
		totalDuration: mph.totalDuration,
		durationCount: mph.logsCount,
		totalTimeToFirstToken: mph.totalTimeToFirstToken,
		timeToFirstTokenCount: mph.timeToFirstTokenCount,
		totalTimeToFirstReasoningToken: mph.totalTimeToFirstReasoningToken,
		timeToFirstReasoningTokenCount: mph.timeToFirstReasoningTokenCount,
	});

	return {
		async bucketTotals() {
			const rows = await db
				.select({
					bucket: bucketExpr.as("bucket"),
					requestCount: requests.as("request_count"),
					errorCount: errors.as("error_count"),
					...latency,
				})
				.from(mph)
				.where(and(...filters))
				.groupBy(bucketExpr)
				.orderBy(asc(bucketExpr));
			return rows.map((row) => ({
				bucket: row.bucket,
				requestCount: Number(row.requestCount),
				errorCount: Number(row.errorCount),
				...readLatency(row),
			}));
		},
		async keyTotals() {
			const rows = await db
				.select({
					key: keyExpr.as("key"),
					requestCount: requests.as("request_count"),
					errorCount: errors.as("error_count"),
					...latency,
				})
				.from(mph)
				.where(and(...filters))
				.groupBy(keyExpr);
			return rows.map((row) => ({
				key: row.key,
				requestCount: Number(row.requestCount),
				errorCount: Number(row.errorCount),
				...readLatency(row),
			}));
		},
		async keyBuckets(keys) {
			const rows = await db
				.select({
					bucket: bucketExpr.as("bucket"),
					key: keyExpr.as("key"),
					requestCount: requests.as("request_count"),
					...latency,
				})
				.from(mph)
				.where(and(...filters, inArray(keyExpr, keys)))
				.groupBy(bucketExpr, keyExpr)
				.orderBy(asc(bucketExpr));
			return rows.map((row) => ({
				bucket: row.bucket,
				key: row.key,
				requestCount: Number(row.requestCount),
				...readLatency(row),
			}));
		},
	};
}

function projectStatsSource(scope: LoadScope): LoadSource {
	const keyScoped = scope.groupBy === "api-key" || Boolean(scope.apiKeyId);
	const modelAxis = scope.groupBy === "model" || scope.groupBy === "provider";

	const apiKeyTable = modelAxis
		? tables.apiKeyHourlyModelStats
		: tables.apiKeyHourlyStats;
	const projectTable = modelAxis
		? tables.projectHourlyModelStats
		: tables.projectHourlyStats;
	const statsTable = keyScoped ? apiKeyTable : projectTable;
	const modelTable = keyScoped
		? tables.apiKeyHourlyModelStats
		: tables.projectHourlyModelStats;

	const countColumn =
		scope.mode === "credits"
			? statsTable.creditsRequestCount
			: scope.mode === "api-keys"
				? statsTable.apiKeysRequestCount
				: statsTable.requestCount;

	let keyExpr: SQL<string>;
	switch (scope.groupBy) {
		case "organization":
			keyExpr = sql<string>`${tables.project.organizationId}`;
			break;
		case "project":
			keyExpr = sql<string>`${statsTable.projectId}`;
			break;
		case "api-key":
			keyExpr = sql<string>`${apiKeyTable.apiKeyId}`;
			break;
		case "provider":
			keyExpr = sql<string>`${modelTable.usedProvider}`;
			break;
		default:
			keyExpr =
				scope.modelView === "canonical"
					? canonicalModelExpression(modelTable.usedModel)
					: sql<string>`${modelTable.usedModel}`;
			break;
	}

	const filters = [gte(statsTable.hourTimestamp, loadRangeStart(scope))];
	if (scope.organizationId) {
		filters.push(eq(tables.project.organizationId, scope.organizationId));
	}
	if (scope.projectId) {
		filters.push(eq(statsTable.projectId, scope.projectId));
	}
	if (scope.apiKeyId) {
		filters.push(eq(apiKeyTable.apiKeyId, scope.apiKeyId));
	}

	const bucketExpr = bucketExpression(statsTable.hourTimestamp, scope.bucket);
	const requests = sql<number>`COALESCE(SUM(${countColumn}), 0)::float8`;
	const errors = sql<number>`COALESCE(SUM(${statsTable.errorCount}), 0)::float8`;
	// `durationCount` is deliberately not `requestCount` here: buckets aggregated
	// before the latency columns existed carry a zero count, which is what makes
	// the response say "unknown" instead of "0 ms".
	const latency = latencySums(statsTable);
	// Every tenant rollup keys on projectId only; the organization id lives one
	// hop up, so the join is unconditional and the org filter and the org
	// grouping stay on the same code path.
	const joinProject = eq(tables.project.id, statsTable.projectId);

	return {
		async bucketTotals() {
			const rows = await db
				.select({
					bucket: bucketExpr.as("bucket"),
					requestCount: requests.as("request_count"),
					errorCount: errors.as("error_count"),
					...latency,
				})
				.from(statsTable)
				.innerJoin(tables.project, joinProject)
				.where(and(...filters))
				.groupBy(bucketExpr)
				.orderBy(asc(bucketExpr));
			return rows.map((row) => ({
				bucket: row.bucket,
				requestCount: Number(row.requestCount),
				errorCount: Number(row.errorCount),
				...readLatency(row),
			}));
		},
		async keyTotals() {
			const rows = await db
				.select({
					key: keyExpr.as("key"),
					requestCount: requests.as("request_count"),
					errorCount: errors.as("error_count"),
					...latency,
				})
				.from(statsTable)
				.innerJoin(tables.project, joinProject)
				.where(and(...filters))
				.groupBy(keyExpr);
			return rows.map((row) => ({
				key: row.key,
				requestCount: Number(row.requestCount),
				errorCount: Number(row.errorCount),
				...readLatency(row),
			}));
		},
		async keyBuckets(keys) {
			const rows = await db
				.select({
					bucket: bucketExpr.as("bucket"),
					key: keyExpr.as("key"),
					requestCount: requests.as("request_count"),
					...latency,
				})
				.from(statsTable)
				.innerJoin(tables.project, joinProject)
				.where(and(...filters, inArray(keyExpr, keys)))
				.groupBy(bucketExpr, keyExpr)
				.orderBy(asc(bucketExpr));
			return rows.map((row) => ({
				bucket: row.bucket,
				key: row.key,
				requestCount: Number(row.requestCount),
				...readLatency(row),
			}));
		},
	};
}

async function resolveLabels(
	scope: LoadScope,
	keys: string[],
): Promise<Map<string, string>> {
	const labels = new Map<string, string>();
	if (keys.length === 0) {
		return labels;
	}

	switch (scope.groupBy) {
		case "organization": {
			const rows = await db
				.select({ id: tables.organization.id, name: tables.organization.name })
				.from(tables.organization)
				.where(inArray(tables.organization.id, keys));
			for (const row of rows) {
				labels.set(row.id, row.name);
			}
			break;
		}
		case "project": {
			const rows = await db
				.select({ id: tables.project.id, name: tables.project.name })
				.from(tables.project)
				.where(inArray(tables.project.id, keys));
			for (const row of rows) {
				labels.set(row.id, row.name);
			}
			break;
		}
		case "api-key": {
			const rows = await db
				.select({
					id: tables.apiKey.id,
					description: tables.apiKey.description,
				})
				.from(tables.apiKey)
				.where(inArray(tables.apiKey.id, keys));
			for (const row of rows) {
				labels.set(row.id, row.description);
			}
			break;
		}
		case "provider": {
			// Catalogue providers have a display name in code; an Airside-listed
			// one only exists as a row, so fall back to that before a raw id.
			const unresolved: string[] = [];
			for (const key of keys) {
				const definition = getProviderDefinition(key);
				if (definition) {
					labels.set(key, definition.name);
				} else {
					unresolved.push(key);
				}
			}
			if (unresolved.length > 0) {
				const rows = await db
					.select({ id: tables.provider.id, name: tables.provider.name })
					.from(tables.provider)
					.where(inArray(tables.provider.id, unresolved));
				for (const row of rows) {
					labels.set(row.id, row.name);
				}
			}
			break;
		}
		default:
			break;
	}

	return labels;
}

const loadSeriesSchema = z.object({
	key: z.string(),
	label: z.string(),
});

// `null` means "no sample in this bucket" — a gap the client must draw as a
// gap, never as a zero.
const latencyShape = {
	avgDurationMs: z.number().nullable(),
	avgTimeToFirstTokenMs: z.number().nullable(),
};

const loadPointEntrySchema = z.object({
	key: z.string(),
	requestCount: z.number(),
	rps: z.number(),
	...latencyShape,
});

const loadPointSchema = z.object({
	timestamp: z.string(),
	// The trailing bucket is still filling. Its rate is already normalized by
	// the elapsed seconds, but clients should still mark it as provisional.
	partial: z.boolean(),
	bucketSeconds: z.number(),
	requestCount: z.number(),
	rps: z.number(),
	...latencyShape,
	entries: z.array(loadPointEntrySchema),
});

const loadBreakdownRowSchema = z.object({
	key: z.string(),
	label: z.string(),
	requestCount: z.number(),
	avgRps: z.number(),
	peakRps: z.number(),
	share: z.number(),
	errorRate: z.number().nullable(),
	...latencyShape,
});

const loadOverviewResponseSchema = z.object({
	window: tokenWindowSchema,
	bucket: loadBucketSchema,
	source: loadSourceSchema,
	groupBy: loadGroupBySchema,
	modelView: loadModelViewSchema,
	mode: loadModeSchema,
	asOf: z.string(),
	summary: z.object({
		currentRps: z.number(),
		// Length of the trailing window `currentRps` averages over, so the client
		// can label it honestly instead of implying an instantaneous reading.
		currentSeconds: z.number(),
		avgRps: z.number(),
		peakRps: z.number(),
		peakAt: z.string().nullable(),
		totalRequests: z.number(),
		errorRate: z.number().nullable(),
		...latencyShape,
	}),
	series: z.array(loadSeriesSchema),
	data: z.array(loadPointSchema),
	breakdown: z.array(loadBreakdownRowSchema),
	totalKeys: z.number(),
});

const getLoadOverview = createRoute({
	method: "get",
	path: "/load/overview",
	request: {
		query: z.object({
			window: tokenWindowSchema.default("1h").optional(),
			bucket: loadBucketSchema.optional(),
			groupBy: loadGroupBySchema.default("model").optional(),
			modelView: loadModelViewSchema.default("canonical").optional(),
			mode: loadModeSchema.default("total").optional(),
			organizationId: z.string().optional(),
			projectId: z.string().optional(),
			apiKeyId: z.string().optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: loadOverviewResponseSchema.openapi({}),
				},
			},
			description:
				"Live gateway request rate over time, ranked by model, provider, organization, project or API key.",
		},
	},
});

adminLoad.openapi(getLoadOverview, async (c) => {
	const scope = resolveLoadScope(c.req.valid("query"));
	const source =
		scope.source === "mapping-history"
			? mappingHistorySource(scope)
			: projectStatsSource(scope);

	const [bucketTotals, keyTotals] = await Promise.all([
		source.bucketTotals(),
		source.keyTotals(),
	]);

	// A mode filter can leave a key with rows but no requests; ranking it would
	// pad the legend and the table with empty series.
	const rankedKeys = keyTotals
		.filter((row) => row.requestCount > 0)
		.sort((a, b) => b.requestCount - a.requestCount);
	const topKeys = rankedKeys.slice(0, TOP_LOAD_SERIES);
	const [labels, keyBuckets] = await Promise.all([
		resolveLabels(
			scope,
			topKeys.map((row) => row.key),
		),
		topKeys.length > 0
			? source.keyBuckets(topKeys.map((row) => row.key))
			: Promise.resolve([]),
	]);
	const labelFor = (key: string) => labels.get(key) || key;

	const allBuckets = generateLoadBuckets(
		scope.startDate,
		scope.now,
		scope.bucket,
	);
	const secondsFor = new Map(
		allBuckets.map((bucket) => [
			bucket,
			bucketSecondsFor(bucket, scope.bucket, scope.now),
		]),
	);
	const totalsByBucket = new Map(
		bucketTotals.map((row) => [row.bucket, row.requestCount]),
	);
	const latencyByBucket = new Map(bucketTotals.map((row) => [row.bucket, row]));
	const countsByKeyBucket = new Map<string, number>();
	const latencyByKeyBucket = new Map<string, LatencyTotals>();
	for (const row of keyBuckets) {
		const cell = `${row.key}\u0000${row.bucket}`;
		countsByKeyBucket.set(
			cell,
			(countsByKeyBucket.get(cell) ?? 0) + row.requestCount,
		);
		let totals = latencyByKeyBucket.get(cell);
		if (!totals) {
			totals = emptyLatency();
			latencyByKeyBucket.set(cell, totals);
		}
		addLatency(totals, row);
	}

	// The per-mode request columns on the tenant rollups have no matching error
	// or latency split, so a mode-filtered view there would pair credits-only
	// requests with blended errors and blended latency. The mapping history keys
	// on `used_mode`, so both stay exact there.
	const modeComparable =
		scope.mode === "total" || scope.source === "mapping-history";

	const latencyFor = (totals: LatencyTotals | undefined) =>
		totals && modeComparable
			? {
					avgDurationMs:
						totals.durationCount > 0
							? totals.totalDuration / totals.durationCount
							: null,
					avgTimeToFirstTokenMs: avgEffectiveTtft(totals),
				}
			: { avgDurationMs: null, avgTimeToFirstTokenMs: null };

	const data = allBuckets.map((timestamp) => {
		const seconds = secondsFor.get(timestamp) ?? BUCKET_SECONDS[scope.bucket];
		const requestCount = totalsByBucket.get(timestamp) ?? 0;
		return {
			timestamp,
			partial: isPartialBucket(timestamp, scope.bucket, scope.now),
			bucketSeconds: seconds,
			requestCount,
			rps: toRps(requestCount, seconds),
			...latencyFor(latencyByBucket.get(timestamp)),
			entries: topKeys.map(({ key }) => {
				const cell = `${key}\u0000${timestamp}`;
				const count = countsByKeyBucket.get(cell) ?? 0;
				return {
					key,
					requestCount: count,
					rps: toRps(count, seconds),
					...latencyFor(latencyByKeyBucket.get(cell)),
				};
			}),
		};
	});

	// A partial bucket can be a single second wide, which makes its rate far too
	// jumpy to report as a peak or as the headline "current" figure.
	const settledPoints = data.filter((point) => !point.partial);
	const peakPoint = settledPoints.reduce<(typeof data)[number] | null>(
		(best, point) => (best === null || point.rps > best.rps ? point : best),
		null,
	);
	const currentBuckets = settledPoints.slice(
		-CURRENT_RATE_BUCKETS[scope.bucket],
	);
	const currentSeconds = currentBuckets.reduce(
		(sum, point) => sum + point.bucketSeconds,
		0,
	);
	const currentRequests = currentBuckets.reduce(
		(sum, point) => sum + point.requestCount,
		0,
	);
	const elapsedSeconds = allBuckets.reduce(
		(sum, bucket) => sum + (secondsFor.get(bucket) ?? 0),
		0,
	);

	const peakByKey = new Map<string, number>();
	for (const point of settledPoints) {
		for (const entry of point.entries) {
			if (entry.rps > (peakByKey.get(entry.key) ?? 0)) {
				peakByKey.set(entry.key, entry.rps);
			}
		}
	}

	let totalRequests = 0;
	let totalErrors = 0;
	const totalLatency = emptyLatency();
	for (const row of bucketTotals) {
		totalRequests += row.requestCount;
		totalErrors += row.errorCount;
		addLatency(totalLatency, row);
	}

	return c.json({
		window: scope.window,
		bucket: scope.bucket,
		source: scope.source,
		groupBy: scope.groupBy,
		modelView: scope.modelView,
		mode: scope.mode,
		asOf: scope.now.toISOString(),
		summary: {
			currentRps: toRps(currentRequests, currentSeconds),
			currentSeconds,
			avgRps: toRps(totalRequests, elapsedSeconds),
			peakRps: peakPoint?.rps ?? 0,
			peakAt:
				peakPoint && peakPoint.requestCount > 0 ? peakPoint.timestamp : null,
			totalRequests,
			errorRate:
				modeComparable && totalRequests > 0
					? totalErrors / totalRequests
					: null,
			...latencyFor(totalLatency),
		},
		series: topKeys.map(({ key }) => ({ key, label: labelFor(key) })),
		data,
		breakdown: topKeys.map((row) => ({
			key: row.key,
			label: labelFor(row.key),
			requestCount: row.requestCount,
			avgRps: toRps(row.requestCount, elapsedSeconds),
			peakRps: peakByKey.get(row.key) ?? 0,
			share: totalRequests > 0 ? row.requestCount / totalRequests : 0,
			errorRate:
				modeComparable && row.requestCount > 0
					? row.errorCount / row.requestCount
					: null,
			...latencyFor(row),
		})),
		totalKeys: rankedKeys.length,
	});
});

const filterOptionTypeSchema = z.enum(["organization", "project", "api-key"]);

const getLoadFilterOptions = createRoute({
	method: "get",
	path: "/load/filter-options",
	request: {
		query: z.object({
			type: filterOptionTypeSchema,
			q: z.string().optional(),
			id: z.string().optional(),
			limit: z.coerce.number().min(1).max(100).default(25).optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z
						.object({
							options: z.array(
								z.object({
									id: z.string(),
									label: z.string(),
									sublabel: z.string().nullable(),
								}),
							),
						})
						.openapi({}),
				},
			},
			description:
				"Searchable organization, project and API key options for the gateway load filters.",
		},
	},
});

adminLoad.openapi(getLoadFilterOptions, async (c) => {
	const { type, q, id, limit = 25 } = c.req.valid("query");
	const term = q?.trim();
	const pattern = term ? `%${term}%` : null;

	if (type === "organization") {
		const filters = [];
		if (id) {
			filters.push(eq(tables.organization.id, id));
		} else if (pattern) {
			filters.push(
				or(
					ilike(tables.organization.name, pattern),
					ilike(tables.organization.id, pattern),
					ilike(tables.organization.billingEmail, pattern),
				),
			);
		}
		const rows = await db
			.select({
				id: tables.organization.id,
				label: tables.organization.name,
				sublabel: tables.organization.billingEmail,
			})
			.from(tables.organization)
			.where(filters.length ? and(...filters) : undefined)
			.orderBy(desc(tables.organization.createdAt))
			.limit(limit);
		return c.json({
			options: rows.map((row) => ({
				id: row.id,
				label: row.label || row.id,
				sublabel: row.sublabel ?? null,
			})),
		});
	}

	if (type === "project") {
		const filters = [];
		if (id) {
			filters.push(eq(tables.project.id, id));
		} else if (pattern) {
			filters.push(
				or(
					ilike(tables.project.name, pattern),
					ilike(tables.project.id, pattern),
					ilike(tables.organization.name, pattern),
				),
			);
		}
		const rows = await db
			.select({
				id: tables.project.id,
				label: tables.project.name,
				sublabel: tables.organization.name,
			})
			.from(tables.project)
			.innerJoin(
				tables.organization,
				eq(tables.organization.id, tables.project.organizationId),
			)
			.where(filters.length ? and(...filters) : undefined)
			.orderBy(desc(tables.project.createdAt))
			.limit(limit);
		return c.json({
			options: rows.map((row) => ({
				id: row.id,
				label: row.label || row.id,
				sublabel: row.sublabel ?? null,
			})),
		});
	}

	const filters = [];
	if (id) {
		filters.push(eq(tables.apiKey.id, id));
	} else if (pattern) {
		filters.push(
			or(
				ilike(tables.apiKey.description, pattern),
				ilike(tables.apiKey.id, pattern),
				ilike(tables.project.name, pattern),
			),
		);
	}
	const rows = await db
		.select({
			id: tables.apiKey.id,
			label: tables.apiKey.description,
			projectName: tables.project.name,
			organizationName: tables.organization.name,
		})
		.from(tables.apiKey)
		.innerJoin(tables.project, eq(tables.project.id, tables.apiKey.projectId))
		.innerJoin(
			tables.organization,
			eq(tables.organization.id, tables.project.organizationId),
		)
		.where(filters.length ? and(...filters) : undefined)
		.orderBy(desc(tables.apiKey.createdAt))
		.limit(limit);

	return c.json({
		options: rows.map((row) => ({
			id: row.id,
			label: row.label || row.id,
			sublabel: `${row.organizationName} / ${row.projectName}`,
		})),
	});
});
