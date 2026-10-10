import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";

import {
	BUCKET_SECONDS,
	bucketSecondsFor,
	formatLoadBucket,
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
import { adminTokenCapacity } from "@/routes/admin-token-capacity.js";
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
	lt,
	or,
	sql,
	tables,
} from "@llmgateway/db";
import { getProviderDefinition } from "@llmgateway/models";
import { deriveStabilityMetrics } from "@llmgateway/shared";

import type { ServerTypes } from "@/vars.js";
import type { AnyColumn, SQL, TtftTotals } from "@llmgateway/db";

export const adminLoad = new OpenAPIHono<ServerTypes>();

adminLoad.use("/*", adminMiddleware);
adminLoad.route("/", adminTokenCapacity);

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
const loadRankBySchema = z.enum(["requests", "errors"]);

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
	rankBy: z.infer<typeof loadRankBySchema>;
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
	rankBy?: z.infer<typeof loadRankBySchema>;
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
		rankBy: query.rankBy ?? "requests",
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

/**
 * The unified finish-reason split rather than `log.hasError`, so the error
 * rate here is the same one `deriveStabilityMetrics` reports on every other
 * model stability view.
 */
interface ErrorTotals {
	clientErrors: number;
	gatewayErrors: number;
	upstreamErrors: number;
}

interface LoadTotals extends LatencyTotals, ErrorTotals {
	requestCount: number;
}

interface BucketTotalRow extends LoadTotals {
	bucket: string;
}

interface KeyTotalRow extends LoadTotals {
	key: string;
}

interface KeyBucketRow extends LoadTotals {
	bucket: string;
	key: string;
}

function emptyTotals(): LoadTotals {
	return {
		requestCount: 0,
		clientErrors: 0,
		gatewayErrors: 0,
		upstreamErrors: 0,
		totalDuration: 0,
		durationCount: 0,
		totalTimeToFirstToken: 0,
		timeToFirstTokenCount: 0,
		totalTimeToFirstReasoningToken: 0,
		timeToFirstReasoningTokenCount: 0,
	};
}

function addTotals(into: LoadTotals, from: LoadTotals): void {
	into.requestCount += from.requestCount;
	into.clientErrors += from.clientErrors;
	into.gatewayErrors += from.gatewayErrors;
	into.upstreamErrors += from.upstreamErrors;
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

function errorSums(columns: {
	clientErrors: AnyColumn;
	gatewayErrors: AnyColumn;
	upstreamErrors: AnyColumn;
}) {
	return {
		clientErrors:
			sql<number>`COALESCE(SUM(${columns.clientErrors}), 0)::float8`.as(
				"client_errors",
			),
		gatewayErrors:
			sql<number>`COALESCE(SUM(${columns.gatewayErrors}), 0)::float8`.as(
				"gateway_errors",
			),
		upstreamErrors:
			sql<number>`COALESCE(SUM(${columns.upstreamErrors}), 0)::float8`.as(
				"upstream_errors",
			),
	};
}

function readTotals(row: LoadTotals): LoadTotals {
	return {
		requestCount: Number(row.requestCount),
		clientErrors: Number(row.clientErrors),
		gatewayErrors: Number(row.gatewayErrors),
		upstreamErrors: Number(row.upstreamErrors),
		totalDuration: Number(row.totalDuration),
		durationCount: Number(row.durationCount),
		totalTimeToFirstToken: Number(row.totalTimeToFirstToken),
		timeToFirstTokenCount: Number(row.timeToFirstTokenCount),
		totalTimeToFirstReasoningToken: Number(row.totalTimeToFirstReasoningToken),
		timeToFirstReasoningTokenCount: Number(row.timeToFirstReasoningTokenCount),
	};
}

function readPeaks(rows: { key: string; peak: number }[]): Map<string, number> {
	return new Map(rows.map((row) => [row.key, Number(row.peak)]));
}

/**
 * The shapes every load view needs. They are separate queries on purpose:
 * one combined `GROUP BY bucket, key` would return `keys x buckets` rows, which
 * for a cross-tenant organization ranking over 90 days is six figures of rows
 * per poll. Ranking first and only bucketing the top series keeps every result
 * set bounded.
 */
interface LoadSource {
	bucketTotals: () => Promise<BucketTotalRow[]>;
	keyTotals: () => Promise<KeyTotalRow[]>;
	keyBuckets: (keys: string[]) => Promise<KeyBucketRow[]>;
	/** Busiest bucket per key, counting only buckets that start before `before`. */
	keyPeaks: (before: Date) => Promise<Map<string, number>>;
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
	const totals = {
		requestCount: requests.as("request_count"),
		...errorSums({
			clientErrors: mph.clientErrorsCount,
			gatewayErrors: mph.gatewayErrorsCount,
			upstreamErrors: mph.upstreamErrorsCount,
		}),
		...latency,
	};

	return {
		async bucketTotals() {
			const rows = await db
				.select({
					bucket: bucketExpr.as("bucket"),
					...totals,
				})
				.from(mph)
				.where(and(...filters))
				.groupBy(bucketExpr)
				.orderBy(asc(bucketExpr));
			return rows.map((row) => ({
				bucket: row.bucket,
				...readTotals(row),
			}));
		},
		async keyTotals() {
			const rows = await db
				.select({
					key: keyExpr.as("key"),
					...totals,
				})
				.from(mph)
				.where(and(...filters))
				.groupBy(keyExpr);
			return rows.map((row) => ({
				key: row.key,
				...readTotals(row),
			}));
		},
		async keyBuckets(keys) {
			const rows = await db
				.select({
					bucket: bucketExpr.as("bucket"),
					key: keyExpr.as("key"),
					...totals,
				})
				.from(mph)
				.where(and(...filters, inArray(keyExpr, keys)))
				.groupBy(bucketExpr, keyExpr)
				.orderBy(asc(bucketExpr));
			return rows.map((row) => ({
				bucket: row.bucket,
				key: row.key,
				...readTotals(row),
			}));
		},
		async keyPeaks(before) {
			const perBucket = db
				.select({
					key: keyExpr.as("key"),
					requestCount: requests.as("request_count"),
				})
				.from(mph)
				.where(and(...filters, lt(mphTs, before)))
				.groupBy(bucketExpr, keyExpr)
				.as("per_bucket");
			return readPeaks(
				await db
					.select({
						key: perBucket.key,
						peak: sql<number>`MAX(${perBucket.requestCount})::float8`,
					})
					.from(perBucket)
					.groupBy(perBucket.key),
			);
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
	// `durationCount` is deliberately not `requestCount` here: buckets aggregated
	// before the latency columns existed carry a zero count, which is what makes
	// the response say "unknown" instead of "0 ms".
	const totals = {
		requestCount: requests.as("request_count"),
		...errorSums({
			clientErrors: statsTable.clientErrorCount,
			gatewayErrors: statsTable.gatewayErrorCount,
			upstreamErrors: statsTable.upstreamErrorCount,
		}),
		...latencySums(statsTable),
	};
	// Every tenant rollup keys on projectId only; the organization id lives one
	// hop up, so the join is unconditional and the org filter and the org
	// grouping stay on the same code path.
	const joinProject = eq(tables.project.id, statsTable.projectId);

	return {
		async bucketTotals() {
			const rows = await db
				.select({
					bucket: bucketExpr.as("bucket"),
					...totals,
				})
				.from(statsTable)
				.innerJoin(tables.project, joinProject)
				.where(and(...filters))
				.groupBy(bucketExpr)
				.orderBy(asc(bucketExpr));
			return rows.map((row) => ({
				bucket: row.bucket,
				...readTotals(row),
			}));
		},
		async keyTotals() {
			const rows = await db
				.select({
					key: keyExpr.as("key"),
					...totals,
				})
				.from(statsTable)
				.innerJoin(tables.project, joinProject)
				.where(and(...filters))
				.groupBy(keyExpr);
			return rows.map((row) => ({
				key: row.key,
				...readTotals(row),
			}));
		},
		async keyBuckets(keys) {
			const rows = await db
				.select({
					bucket: bucketExpr.as("bucket"),
					key: keyExpr.as("key"),
					...totals,
				})
				.from(statsTable)
				.innerJoin(tables.project, joinProject)
				.where(and(...filters, inArray(keyExpr, keys)))
				.groupBy(bucketExpr, keyExpr)
				.orderBy(asc(bucketExpr));
			return rows.map((row) => ({
				bucket: row.bucket,
				key: row.key,
				...readTotals(row),
			}));
		},
		async keyPeaks(before) {
			const perBucket = db
				.select({
					key: keyExpr.as("key"),
					requestCount: requests.as("request_count"),
				})
				.from(statsTable)
				.innerJoin(tables.project, joinProject)
				.where(and(...filters, lt(statsTable.hourTimestamp, before)))
				.groupBy(bucketExpr, keyExpr)
				.as("per_bucket");
			return readPeaks(
				await db
					.select({
						key: perBucket.key,
						peak: sql<number>`MAX(${perBucket.requestCount})::float8`,
					})
					.from(perBucket)
					.groupBy(perBucket.key),
			);
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
	// Gateway + upstream errors over non-client requests, as in
	// `deriveStabilityMetrics`; client errors are reported separately so a
	// caller's malformed requests never read as a model failure.
	errorRate: z.number().nullable(),
	clientErrorRate: z.number().nullable(),
};

const errorCountShape = {
	errorCount: z.number().nullable(),
	clientErrorCount: z.number().nullable(),
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
	...latencyShape,
	...errorCountShape,
});

const loadOverviewResponseSchema = z.object({
	window: tokenWindowSchema,
	bucket: loadBucketSchema,
	source: loadSourceSchema,
	// The summary depends only on the filters, never on the grouping, so it can
	// come from a different rollup than the chart.
	summarySource: loadSourceSchema,
	groupBy: loadGroupBySchema,
	modelView: loadModelViewSchema,
	mode: loadModeSchema,
	rankBy: loadRankBySchema,
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
		...latencyShape,
		...errorCountShape,
	}),
	series: z.array(loadSeriesSchema),
	data: z.array(loadPointSchema),
	breakdown: z.array(loadBreakdownRowSchema),
	totalKeys: z.number(),
});

const loadQuerySchema = z.object({
	window: tokenWindowSchema.default("1h").optional(),
	bucket: loadBucketSchema.optional(),
	groupBy: loadGroupBySchema.default("model").optional(),
	modelView: loadModelViewSchema.default("canonical").optional(),
	mode: loadModeSchema.default("total").optional(),
	rankBy: loadRankBySchema.default("requests").optional(),
	organizationId: z.string().optional(),
	projectId: z.string().optional(),
	apiKeyId: z.string().optional(),
});

const getLoadOverview = createRoute({
	method: "get",
	path: "/load/overview",
	request: {
		query: loadQuerySchema,
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: loadOverviewResponseSchema.openapi({}),
				},
			},
			description:
				"Live gateway request rate, latency and error rate over time, ranked by model, provider, organization, project or API key.",
		},
	},
});

// Keep hourly spikes before rolling long-range charts up to days.
function peakBucketFor(bucket: LoadBucket): LoadBucket {
	return bucket === "day" ? "hour" : bucket;
}

function openLoadSource(scope: LoadScope): LoadSource {
	const sourceScope = {
		...scope,
		bucket: peakBucketFor(scope.bucket),
		startDate: loadRangeStart(scope),
	};
	return scope.source === "mapping-history"
		? mappingHistorySource(sourceScope)
		: projectStatsSource(sourceScope);
}

/**
 * The headline figures describe all traffic matching the filters, so they
 * must not move when only the grouping does. Grouping by model reads the
 * minute-grain mapping history and grouping by organization the hourly tenant
 * rollups, so taking the summary from the chart's source reported a one-minute
 * spike as the peak on one tab and an hourly average on the next.
 */
function summaryScopeFor(query: LoadQuery, now: Date): LoadScope {
	const tenantFiltered = Boolean(
		query.organizationId || query.projectId || query.apiKeyId,
	);
	return resolveLoadScope(
		{ ...query, groupBy: tenantFiltered ? "project" : "model" },
		now,
	);
}

/**
 * The per-mode request columns on the tenant rollups have no matching error
 * or latency split, so a mode-filtered view there would pair credits-only
 * requests with blended errors and blended latency. The mapping history keys
 * on `used_mode`, so both stay exact there.
 */
function isModeComparable(scope: LoadScope): boolean {
	return scope.mode === "total" || scope.source === "mapping-history";
}

function stabilityFor(totals: LoadTotals) {
	return deriveStabilityMetrics({
		logsCount: totals.requestCount,
		clientErrorsCount: totals.clientErrors,
		gatewayErrorsCount: totals.gatewayErrors,
		upstreamErrorsCount: totals.upstreamErrors,
	});
}

function qualityFor(totals: LoadTotals | undefined, modeComparable: boolean) {
	if (!totals || !modeComparable) {
		return {
			avgDurationMs: null,
			avgTimeToFirstTokenMs: null,
			errorRate: null,
			clientErrorRate: null,
		};
	}
	const { errorRate } = stabilityFor(totals);
	return {
		avgDurationMs:
			totals.durationCount > 0
				? totals.totalDuration / totals.durationCount
				: null,
		avgTimeToFirstTokenMs: avgEffectiveTtft(totals),
		errorRate: errorRate === null ? null : errorRate / 100,
		clientErrorRate:
			totals.requestCount > 0
				? Math.min(totals.clientErrors, totals.requestCount) /
					totals.requestCount
				: null,
	};
}

function errorCountsFor(totals: LoadTotals, modeComparable: boolean) {
	return modeComparable
		? {
				errorCount: stabilityFor(totals).errorsCount,
				clientErrorCount: Math.min(totals.clientErrors, totals.requestCount),
			}
		: { errorCount: null, clientErrorCount: null };
}

interface LoadGrid {
	buckets: string[];
	secondsFor: Map<string, number>;
	elapsedSeconds: number;
}

function loadGrid(scope: LoadScope): LoadGrid {
	const buckets = generateLoadBuckets(scope.startDate, scope.now, scope.bucket);
	const secondsFor = new Map(
		buckets.map((bucket) => [
			bucket,
			bucketSecondsFor(bucket, scope.bucket, scope.now),
		]),
	);
	const elapsedSeconds = buckets.reduce(
		(sum, bucket) => sum + (secondsFor.get(bucket) ?? 0),
		0,
	);
	return { buckets, secondsFor, elapsedSeconds };
}

function chartBucketFor(timestamp: string, unit: LoadBucket): string {
	return formatLoadBucket(truncateToLoadBucket(new Date(timestamp), unit));
}

function sumTotals(rows: LoadTotals[]): LoadTotals {
	const total = emptyTotals();
	for (const row of rows) {
		addTotals(total, row);
	}
	return total;
}

function summarizeLoad(scope: LoadScope, bucketTotals: BucketTotalRow[]) {
	const peakBucket = peakBucketFor(scope.bucket);
	const modeComparable = isModeComparable(scope);
	const { buckets, secondsFor, elapsedSeconds } = loadGrid(scope);

	const requestsByBucket = new Map<string, number>();
	for (const row of bucketTotals) {
		const bucket = chartBucketFor(row.bucket, scope.bucket);
		requestsByBucket.set(
			bucket,
			(requestsByBucket.get(bucket) ?? 0) + row.requestCount,
		);
	}

	// A partial bucket can be a single second wide, which makes its rate far too
	// jumpy to report as a peak or as the headline "current" figure.
	const currentBuckets = buckets
		.filter((bucket) => !isPartialBucket(bucket, scope.bucket, scope.now))
		.slice(-CURRENT_RATE_BUCKETS[scope.bucket]);
	const currentSeconds = currentBuckets.reduce(
		(sum, bucket) => sum + (secondsFor.get(bucket) ?? 0),
		0,
	);
	const currentRequests = currentBuckets.reduce(
		(sum, bucket) => sum + (requestsByBucket.get(bucket) ?? 0),
		0,
	);
	const peakPoint = bucketTotals
		.filter((row) => !isPartialBucket(row.bucket, peakBucket, scope.now))
		.reduce<BucketTotalRow | null>(
			(best, row) =>
				best === null || row.requestCount > best.requestCount ? row : best,
			null,
		);
	const total = sumTotals(bucketTotals);

	return {
		currentRps: toRps(currentRequests, currentSeconds),
		currentSeconds,
		avgRps: toRps(total.requestCount, elapsedSeconds),
		peakRps: toRps(peakPoint?.requestCount ?? 0, BUCKET_SECONDS[peakBucket]),
		peakAt: peakPoint && peakPoint.requestCount > 0 ? peakPoint.bucket : null,
		totalRequests: total.requestCount,
		...qualityFor(total, modeComparable),
		...errorCountsFor(total, modeComparable),
	};
}

adminLoad.openapi(getLoadOverview, async (c) => {
	const query = c.req.valid("query");
	const now = new Date();
	const scope = resolveLoadScope(query, now);
	const summaryScope = summaryScopeFor(query, now);
	const peakBucket = peakBucketFor(scope.bucket);
	const source = openLoadSource(scope);
	// Mapping-history bucket totals ignore the grouping, so the chart's rows
	// already answer the summary whenever the grain matches.
	const summaryShared =
		summaryScope.source === scope.source &&
		summaryScope.bucket === scope.bucket &&
		(scope.source === "mapping-history" ||
			summaryScope.groupBy === scope.groupBy);

	const [bucketTotals, keyTotals, summaryBucketTotals] = await Promise.all([
		source.bucketTotals(),
		source.keyTotals(),
		summaryShared ? null : openLoadSource(summaryScope).bucketTotals(),
	]);

	const modeComparable = isModeComparable(scope);

	// Ranked by absolute error count rather than rate, so a key with a single
	// failed request cannot outrank one failing thousands.
	const errorRanked = scope.rankBy === "errors" && modeComparable;
	const rankedKeys = keyTotals
		// A mode filter can leave a key with rows but no requests; ranking it
		// would pad the legend and the table with empty series.
		.filter((row) => row.requestCount > 0)
		.map((row) => ({
			...row,
			errorCount: stabilityFor(row).errorsCount,
		}))
		.sort(
			(a, b) =>
				(errorRanked ? b.errorCount - a.errorCount : 0) ||
				b.requestCount - a.requestCount,
		);
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

	const { buckets: allBuckets, secondsFor, elapsedSeconds } = loadGrid(scope);
	const totalsByBucket = new Map<string, LoadTotals>();
	for (const row of bucketTotals) {
		const bucket = chartBucketFor(row.bucket, scope.bucket);
		let totals = totalsByBucket.get(bucket);
		if (!totals) {
			totals = emptyTotals();
			totalsByBucket.set(bucket, totals);
		}
		addTotals(totals, row);
	}
	const totalsByKeyBucket = new Map<string, LoadTotals>();
	for (const row of keyBuckets) {
		const cell = `${row.key}\u0000${chartBucketFor(row.bucket, scope.bucket)}`;
		let totals = totalsByKeyBucket.get(cell);
		if (!totals) {
			totals = emptyTotals();
			totalsByKeyBucket.set(cell, totals);
		}
		addTotals(totals, row);
	}

	const data = allBuckets.map((timestamp) => {
		const seconds = secondsFor.get(timestamp) ?? BUCKET_SECONDS[scope.bucket];
		const bucketTotal = totalsByBucket.get(timestamp);
		const requestCount = bucketTotal?.requestCount ?? 0;
		return {
			timestamp,
			partial: isPartialBucket(timestamp, scope.bucket, scope.now),
			bucketSeconds: seconds,
			requestCount,
			rps: toRps(requestCount, seconds),
			...qualityFor(bucketTotal, modeComparable),
			entries: topKeys.map(({ key }) => {
				const cellTotals = totalsByKeyBucket.get(`${key}\u0000${timestamp}`);
				const count = cellTotals?.requestCount ?? 0;
				return {
					key,
					requestCount: count,
					rps: toRps(count, seconds),
					...qualityFor(cellTotals, modeComparable),
				};
			}),
		};
	});

	const peakByKey = new Map<string, number>();
	for (const row of keyBuckets) {
		if (isPartialBucket(row.bucket, peakBucket, scope.now)) {
			continue;
		}
		const rps = toRps(row.requestCount, BUCKET_SECONDS[peakBucket]);
		if (rps > (peakByKey.get(row.key) ?? 0)) {
			peakByKey.set(row.key, rps);
		}
	}

	// Shares stay on the chart's own source so the breakdown sums to 100%.
	const chartRequests = sumTotals(bucketTotals).requestCount;

	return c.json({
		window: scope.window,
		bucket: scope.bucket,
		source: scope.source,
		summarySource: summaryScope.source,
		groupBy: scope.groupBy,
		modelView: scope.modelView,
		mode: scope.mode,
		rankBy: scope.rankBy,
		asOf: scope.now.toISOString(),
		summary: summaryShared
			? summarizeLoad(scope, bucketTotals)
			: summarizeLoad(summaryScope, summaryBucketTotals ?? []),
		series: topKeys.map(({ key }) => ({ key, label: labelFor(key) })),
		data,
		breakdown: topKeys.map((row) => ({
			...breakdownRow(row, {
				elapsedSeconds,
				totalRequests: chartRequests,
				peakRps: peakByKey.get(row.key) ?? 0,
				modeComparable,
			}),
			label: labelFor(row.key),
		})),
		totalKeys: rankedKeys.length,
	});
});

function breakdownRow(
	row: KeyTotalRow,
	context: {
		elapsedSeconds: number;
		totalRequests: number;
		peakRps: number;
		modeComparable: boolean;
	},
) {
	return {
		key: row.key,
		requestCount: row.requestCount,
		avgRps: toRps(row.requestCount, context.elapsedSeconds),
		peakRps: context.peakRps,
		share:
			context.totalRequests > 0 ? row.requestCount / context.totalRequests : 0,
		...qualityFor(row, context.modeComparable),
		...errorCountsFor(row, context.modeComparable),
	};
}

const loadBreakdownSortSchema = z.enum([
	"label",
	"requestCount",
	"avgRps",
	"peakRps",
	"share",
	"errorRate",
	"errorCount",
	"clientErrorRate",
	"avgDurationMs",
	"avgTimeToFirstTokenMs",
]);

type LoadBreakdownSort = z.infer<typeof loadBreakdownSortSchema>;

const getLoadBreakdown = createRoute({
	method: "get",
	path: "/load/breakdown",
	request: {
		query: loadQuerySchema.omit({ rankBy: true }).extend({
			sortBy: loadBreakdownSortSchema.default("requestCount").optional(),
			sortOrder: z.enum(["asc", "desc"]).default("desc").optional(),
			page: z.coerce.number().int().min(1).default(1).optional(),
			pageSize: z.coerce.number().int().min(1).max(100).default(25).optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z
						.object({
							rows: z.array(loadBreakdownRowSchema),
							totalKeys: z.number(),
							page: z.number(),
							pageSize: z.number(),
						})
						.openapi({}),
				},
			},
			description:
				"Every key with traffic in the window, sorted on any column and paginated.",
		},
	},
});

/** Nulls (unknown latency or error rate) sort last in either direction. */
function compareBreakdown(
	a: number | string | null,
	b: number | string | null,
	order: "asc" | "desc",
): number {
	if (a === b) {
		return 0;
	}
	if (a === null) {
		return 1;
	}
	if (b === null) {
		return -1;
	}
	const result =
		typeof a === "string" && typeof b === "string"
			? a.localeCompare(b)
			: Number(a) - Number(b);
	return order === "asc" ? result : -result;
}

adminLoad.openapi(getLoadBreakdown, async (c) => {
	const {
		sortBy = "requestCount",
		sortOrder = "desc",
		page = 1,
		pageSize = 25,
		...query
	} = c.req.valid("query");
	const scope = resolveLoadScope(query);
	const peakBucket = peakBucketFor(scope.bucket);
	const source = openLoadSource(scope);
	const modeComparable = isModeComparable(scope);
	const { elapsedSeconds } = loadGrid(scope);

	// Only settled buckets count towards a peak; see `summarizeLoad`.
	const [keyTotals, peaks] = await Promise.all([
		source.keyTotals(),
		source.keyPeaks(truncateToLoadBucket(scope.now, peakBucket)),
	]);
	const peakSeconds = BUCKET_SECONDS[peakBucket];
	// Every key's totals sum to the same filtered total the chart divides by.
	const totalRequests = sumTotals(keyTotals).requestCount;
	const rows = keyTotals
		.filter((row) => row.requestCount > 0)
		.map((row) =>
			breakdownRow(row, {
				elapsedSeconds,
				totalRequests,
				peakRps: toRps(peaks.get(row.key) ?? 0, peakSeconds),
				modeComparable,
			}),
		);

	// Labels are only resolved for every key when they decide the order.
	const labels =
		sortBy === "label"
			? await resolveLabels(
					scope,
					rows.map((row) => row.key),
				)
			: null;
	const sortValue = (
		row: (typeof rows)[number],
		key: LoadBreakdownSort,
	): number | string | null =>
		key === "label" ? labels?.get(row.key) || row.key : row[key];
	rows.sort(
		(a, b) =>
			compareBreakdown(sortValue(a, sortBy), sortValue(b, sortBy), sortOrder) ||
			b.requestCount - a.requestCount ||
			a.key.localeCompare(b.key),
	);

	const lastPage = Math.max(1, Math.ceil(rows.length / pageSize));
	const currentPage = Math.min(page, lastPage);
	const pageRows = rows.slice(
		(currentPage - 1) * pageSize,
		currentPage * pageSize,
	);
	const pageLabels =
		labels ??
		(await resolveLabels(
			scope,
			pageRows.map((row) => row.key),
		));

	return c.json({
		rows: pageRows.map((row) => ({
			...row,
			label: pageLabels.get(row.key) || row.key,
		})),
		totalKeys: rows.length,
		page: currentPage,
		pageSize,
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
