import { z } from "zod";

import {
	and,
	db,
	desc,
	eq,
	gte,
	inArray,
	type SQL,
	sql,
	tables,
} from "@llmgateway/db";
import { providers } from "@llmgateway/models";
import { parseUsedModel } from "@llmgateway/shared";

// Selectable time windows, mapping each value to its SQL interval bound, an
// hours count surfaced to the UI, and the error timeline bucket size (roughly
// 50-100 buckets per window).
export const MAPPING_ERROR_WINDOWS = {
	"1h": {
		interval: sql`now() - interval '1 hour'`,
		hours: 1,
		bucketSeconds: 60,
	},
	"2h": {
		interval: sql`now() - interval '2 hours'`,
		hours: 2,
		bucketSeconds: 120,
	},
	"4h": {
		interval: sql`now() - interval '4 hours'`,
		hours: 4,
		bucketSeconds: 300,
	},
	"8h": {
		interval: sql`now() - interval '8 hours'`,
		hours: 8,
		bucketSeconds: 600,
	},
	"12h": {
		interval: sql`now() - interval '12 hours'`,
		hours: 12,
		bucketSeconds: 900,
	},
	"16h": {
		interval: sql`now() - interval '16 hours'`,
		hours: 16,
		bucketSeconds: 900,
	},
	"24h": {
		interval: sql`now() - interval '24 hours'`,
		hours: 24,
		bucketSeconds: 1800,
	},
	"3d": {
		interval: sql`now() - interval '3 days'`,
		hours: 72,
		bucketSeconds: 3600,
	},
	"7d": {
		interval: sql`now() - interval '7 days'`,
		hours: 168,
		bucketSeconds: 10800,
	},
} as const;

export const mappingErrorWindowSchema = z.enum([
	"1h",
	"2h",
	"4h",
	"8h",
	"12h",
	"16h",
	"24h",
	"3d",
	"7d",
]);

export type MappingErrorWindow = keyof typeof MAPPING_ERROR_WINDOWS;

export function resolveMappingErrorWindow(
	window: MappingErrorWindow | undefined,
	fallback: MappingErrorWindow = "4h",
) {
	return MAPPING_ERROR_WINDOWS[window ?? fallback];
}

// `retried` is nullable; legacy rows predate the column and are NULL. Treat
// those as non-retried so they are not silently dropped.
export const notRetriedClause = sql`AND ${tables.log.retried} IS DISTINCT FROM true`;

// Incidents count only failures the gateway retries: canceled and
// content-filtered requests are neither retried nor outage signals. Matches
// the hourly rollups, which count by finish reason: a 200 that fails
// mid-response is an upstream error with `has_error = false`. Keep it equal to
// the predicate of the partial
// `log_incident_used_provider_used_model_created_at_idx` index.
const incidentErrorsPredicate = sql`${tables.log.unifiedFinishReason} IN ('upstream_error', 'gateway_error')`;

// Safety cap on the error logs one incident drilldown aggregates per mapping;
// below it the counts cover every error in the window.
export const INCIDENT_ERRORS_LOG_LIMIT = 100_000;

// Errors without details (a 200 that failed mid-response) fall back to the
// provider's raw finish reason, unless it only repeats the classification.
const statusTextExpr = sql`COALESCE(error_details->>'statusText', NULLIF(finish_reason, classification))`;

export const mappingErrorShapeSchema = z.object({
	statusCode: z.number().nullable(),
	statusText: z.string().nullable(),
	responseText: z.string().nullable(),
	cause: z.string().nullable(),
	// The gateway's internal classification stored on the log
	// (`unified_finish_reason`, e.g. `gateway_error`, `upstream_error`,
	// `content_filter`). Surfaced because the HTTP status alone is misleading:
	// some 4xx responses are classified as gateway or upstream errors.
	classification: z.string().nullable(),
	// Streaming and non-streaming failures often have different causes, so
	// shapes split on this flag by default. Null when the modes are merged.
	streamed: z.boolean().nullable(),
	count: z.number(),
	// How many of `count` were streaming requests.
	streamedCount: z.number(),
	// Only set when grouped by provider key: the credential that served the
	// failing requests (null = env-var key or never resolved), and that key's
	// total errors in the sample.
	providerKeyId: z.string().nullable().optional(),
	keyErrors: z.number().optional(),
	// Only set when bucketed: this shape's occurrences per time bucket, sparse
	// (empty buckets omitted), keyed by bucket start in epoch milliseconds.
	buckets: z
		.array(z.object({ start: z.number(), count: z.number() }))
		.optional(),
});

export const mappingErrorShapesSchema = z.object({
	errors: z.array(mappingErrorShapeSchema),
	/** Error logs aggregated: every error in the window unless `capped`. */
	sampledErrors: z.number(),
	/** The log limit was reached, so only the latest errors are covered. */
	capped: z.boolean(),
});

/**
 * Top 10 error shapes over the latest `sampleLimit` error logs of one mapping,
 * identified by the exact `log.used_model` value; callers narrow the error
 * classes via `extraClauses`. Served by the partial
 * `log_error_used_provider_used_model_created_at_idx` index, or with
 * `incidentsOnly` (upstream and gateway errors, with or without `has_error`)
 * by `log_incident_used_provider_used_model_created_at_idx`. With
 * `groupByKey`, returns the top 5 shapes of each provider key instead.
 * With `bucketSeconds`, each shape also carries its per-bucket counts.
 * Without `splitByStream`, streaming and non-streaming occurrences of an
 * error merge into one shape.
 */
export async function queryMappingErrorShapes({
	usedModel,
	provider,
	windowInterval,
	sampleLimit,
	extraClauses,
	incidentsOnly = false,
	groupByKey = false,
	bucketSeconds,
	splitByStream = true,
}: {
	usedModel: string;
	provider: string;
	windowInterval: SQL;
	sampleLimit: number;
	extraClauses: SQL[];
	incidentsOnly?: boolean;
	groupByKey?: boolean;
	bucketSeconds?: number;
	splitByStream?: boolean;
}): Promise<z.infer<typeof mappingErrorShapesSchema>> {
	// Ungrouped, every row shares a constant NULL key, so the partition is one
	// bucket and both modes share one query shape.
	const providerKeyExpr = groupByKey
		? sql`${tables.log.providerKeyId}`
		: sql`NULL::text`;
	const perKeyLimit = groupByKey ? 5 : 10;
	const streamGroupExpr = splitByStream ? sql`streamed` : sql`NULL::boolean`;
	// Unbucketed, every row falls into one constant bucket.
	const bucketExpr =
		bucketSeconds !== undefined
			? sql`FLOOR(EXTRACT(EPOCH FROM ${tables.log.createdAt}) / ${bucketSeconds}::int)::bigint * ${bucketSeconds * 1000}::bigint`
			: sql`0::bigint`;
	const rows = await db.execute<{
		status_code: string | null;
		status_text: string | null;
		response_text: string | null;
		cause: string | null;
		classification: string | null;
		streamed: boolean | null;
		provider_key_id: string | null;
		count: string;
		streamed_count: string;
		key_errors: string;
		sampled_errors: string;
		buckets: [number, number][];
	}>(sql`
		WITH recent_errors AS (
			SELECT ${tables.log.errorDetails} AS error_details,
				${providerKeyExpr} AS provider_key_id,
				${tables.log.unifiedFinishReason} AS classification,
				${tables.log.finishReason} AS finish_reason,
				COALESCE(${tables.log.streamed}, false) AS streamed,
				${bucketExpr} AS bucket
			FROM ${tables.log}
			WHERE ${incidentsOnly ? incidentErrorsPredicate : sql`${tables.log.hasError} = true`}
				AND ${tables.log.usedModel} = ${usedModel}
				AND ${tables.log.usedProvider} = ${provider}
				AND ${tables.log.createdAt} >= ${windowInterval}
				${sql.join(extraClauses, sql` `)}
			ORDER BY ${tables.log.createdAt} DESC
			LIMIT ${sampleLimit}
		),
		shape_buckets AS (
			SELECT error_details->>'statusCode' AS status_code,
				${statusTextExpr} AS status_text,
				LEFT(error_details->>'responseText', 2000) AS response_text,
				error_details->>'cause' AS cause,
				classification,
				${streamGroupExpr} AS streamed,
				provider_key_id,
				bucket,
				COUNT(*) AS count,
				COUNT(*) FILTER (WHERE streamed) AS streamed_count
			FROM recent_errors
			GROUP BY 1, 2, 3, 4, classification, 6, provider_key_id, bucket
		),
		shapes AS (
			SELECT status_code,
				status_text,
				response_text,
				cause,
				classification,
				streamed,
				provider_key_id,
				SUM(count) AS count,
				SUM(streamed_count) AS streamed_count,
				json_agg(json_build_array(bucket, count) ORDER BY bucket) AS buckets
			FROM shape_buckets
			GROUP BY status_code, status_text, response_text, cause, classification, streamed, provider_key_id
		),
		ranked AS (
			SELECT *,
				ROW_NUMBER() OVER (PARTITION BY provider_key_id ORDER BY count DESC) AS key_rank,
				SUM(count) OVER (PARTITION BY provider_key_id) AS key_errors
			FROM shapes
		)
		SELECT status_code,
			status_text,
			response_text,
			cause,
			classification,
			streamed,
			provider_key_id,
			count,
			streamed_count,
			key_errors,
			buckets,
			(SELECT COUNT(*) FROM recent_errors) AS sampled_errors
		FROM ranked
		WHERE key_rank <= ${perKeyLimit}
		ORDER BY key_errors DESC, provider_key_id NULLS LAST, count DESC
		LIMIT 100
	`);

	const sampledErrors =
		rows.rows.length > 0 ? Number(rows.rows[0].sampled_errors) : 0;

	return {
		errors: rows.rows.map((r) => ({
			statusCode: r.status_code !== null ? Number(r.status_code) : null,
			statusText: r.status_text,
			responseText: r.response_text,
			cause: r.cause,
			classification: r.classification,
			streamed: r.streamed,
			count: Number(r.count),
			streamedCount: Number(r.streamed_count),
			...(groupByKey
				? {
						providerKeyId: r.provider_key_id,
						keyErrors: Number(r.key_errors),
					}
				: {}),
			...(bucketSeconds !== undefined
				? {
						buckets: r.buckets.map(([start, count]) => ({
							start: Number(start),
							count: Number(count),
						})),
					}
				: {}),
		})),
		sampledErrors,
		capped: sampledErrors >= sampleLimit,
	};
}

// Incidents pages (Airside + admin provider detail) cap the window at 3 days.
export const incidentsWindowSchema = z.enum(["1h", "4h", "24h", "3d"]);

export const incidentsResponseSchema = z.object({
	windowHours: z.number(),
	providerIds: z.array(z.string()),
	mapping: z.string().nullable(),
	mappings: z.array(
		z.object({
			providerId: z.string(),
			providerName: z.string(),
			usedModel: z.string(),
			modelId: z.string(),
			region: z.string().nullable(),
			requestCount: z.number(),
			errorCount: z.number(),
			upstreamErrorCount: z.number(),
			gatewayErrorCount: z.number(),
			errorRate: z.number(),
		}),
	),
});

const providerNamesById = new Map(providers.map((p) => [p.id, p.name]));

/**
 * Per-mapping upstream + gateway error counts from the hourly rollups.
 * Mappings without errors are dropped unless `mapping` narrows to one.
 */
export async function queryIncidentMappings({
	providerIds,
	windowHours,
	mapping,
}: {
	providerIds: string[];
	windowHours: number;
	mapping: string | null;
}): Promise<z.infer<typeof incidentsResponseSchema>["mappings"]> {
	if (providerIds.length === 0) {
		return [];
	}
	const mph = tables.projectHourlyModelStats;
	const windowMs = windowHours * 3_600_000;
	const since = new Date(Date.now() - windowMs);
	since.setMinutes(0, 0, 0);
	const errorExpr = sql`SUM(${mph.upstreamErrorCount}) + SUM(${mph.gatewayErrorCount})`;
	const errorRateExpr = sql`(${errorExpr})::float8 / NULLIF(SUM(${mph.requestCount}), 0)`;

	const rows = await db
		.select({
			providerId: mph.usedProvider,
			usedModel: mph.usedModel,
			requestCount: sql<number>`SUM(${mph.requestCount})::int`,
			errorCount: sql<number>`(${errorExpr})::int`,
			upstreamErrorCount: sql<number>`SUM(${mph.upstreamErrorCount})::int`,
			gatewayErrorCount: sql<number>`SUM(${mph.gatewayErrorCount})::int`,
			errorRate: sql<number>`COALESCE(${errorRateExpr}, 0)`,
		})
		.from(mph)
		.where(
			and(
				inArray(mph.usedProvider, providerIds),
				gte(mph.hourTimestamp, since),
				mapping !== null ? eq(mph.usedModel, mapping) : undefined,
			),
		)
		.groupBy(mph.usedProvider, mph.usedModel)
		.having(mapping !== null ? undefined : sql`${errorExpr} > 0`)
		.orderBy(desc(sql`COALESCE(${errorRateExpr}, 0)`), desc(sql`${errorExpr}`))
		.limit(200);

	return rows.map((row) => ({
		...row,
		...parseUsedModel(row.usedModel, row.providerId),
		providerName: providerNamesById.get(row.providerId) ?? row.providerId,
	}));
}

/** Bucket grid of each error's `buckets`, covering the selected window. */
export const errorTimelineSchema = z.object({
	bucketSeconds: z.number(),
	/** First and last bucket start, epoch milliseconds. */
	start: z.number(),
	end: z.number(),
});

export function buildErrorTimeline(windowHours: number, bucketSeconds: number) {
	const bucketMs = bucketSeconds * 1000;
	const now = Date.now();
	const windowMs = windowHours * 3_600_000;
	return {
		bucketSeconds,
		start: Math.floor((now - windowMs) / bucketMs) * bucketMs,
		end: Math.floor(now / bucketMs) * bucketMs,
	};
}

export const incidentErrorTypesSchema = z.object({
	errors: z.array(
		z.object({
			statusCode: z.number().nullable(),
			statusText: z.string().nullable(),
			responseText: z.string().nullable(),
			cause: z.string().nullable(),
			classification: z.string().nullable(),
			count: z.number(),
			// How many of `count` were streaming requests.
			streamedCount: z.number(),
			// Mappings that hit this error, most occurrences first.
			models: z.array(
				z.object({
					providerId: z.string(),
					usedModel: z.string(),
					modelId: z.string(),
					region: z.string().nullable(),
					count: z.number(),
					streamedCount: z.number(),
				}),
			),
			// Only set when bucketed: occurrences per time bucket across all
			// mappings, sparse, keyed by bucket start in epoch milliseconds.
			buckets: z
				.array(z.object({ start: z.number(), count: z.number() }))
				.optional(),
		}),
	),
	/** Error logs aggregated: every error in the window unless capped. */
	sampledErrors: z.number(),
	/** Most error logs aggregated per mapping. */
	sampleLimit: z.number(),
	/** Mappings that hit `sampleLimit`; their counts are lower bounds. */
	cappedMappings: z.number(),
});

/**
 * Top 50 error shapes across mappings, each with its per-mapping counts.
 * Reads the upstream and gateway error logs of every mapping separately so
 * each lookup stays on the partial
 * `log_incident_used_provider_used_model_created_at_idx` index; the hourly
 * rollups hold no error details. With `bucketSeconds`, each shape also
 * carries its per-bucket counts.
 */
export async function queryIncidentErrorTypes({
	mappings,
	windowInterval,
	extraClauses,
	bucketSeconds,
}: {
	mappings: { providerId: string; usedModel: string }[];
	windowInterval: SQL;
	extraClauses: SQL[];
	bucketSeconds?: number;
}): Promise<z.infer<typeof incidentErrorTypesSchema>> {
	const sampleLimit = INCIDENT_ERRORS_LOG_LIMIT;
	// Unbucketed, every row falls into one constant bucket.
	const bucketExpr =
		bucketSeconds !== undefined
			? sql`FLOOR(EXTRACT(EPOCH FROM ${tables.log.createdAt}) / ${bucketSeconds}::int)::bigint * ${bucketSeconds * 1000}::bigint`
			: sql`0::bigint`;
	if (mappings.length === 0) {
		return { errors: [], sampledErrors: 0, sampleLimit, cappedMappings: 0 };
	}
	const rows = await db.execute<{
		status_code: string | null;
		status_text: string | null;
		response_text: string | null;
		cause: string | null;
		classification: string | null;
		count: string;
		streamed_count: string;
		models: [string, string, number, number][];
		buckets: [number, number][];
		sampled_errors: string;
		capped_mappings: string;
	}>(sql`
		WITH mappings (used_provider, used_model) AS (
			VALUES ${sql.join(
				mappings.map(
					(mapping) =>
						sql`(${mapping.providerId}::text, ${mapping.usedModel}::text)`,
				),
				sql`, `,
			)}
		),
		recent_errors AS (
			SELECT mappings.used_provider,
				mappings.used_model,
				sampled.error_details->>'statusCode' AS status_code,
				COALESCE(sampled.error_details->>'statusText', NULLIF(sampled.finish_reason, sampled.classification)) AS status_text,
				LEFT(sampled.error_details->>'responseText', 2000) AS response_text,
				sampled.error_details->>'cause' AS cause,
				sampled.classification,
				sampled.streamed,
				sampled.bucket
			FROM mappings
			CROSS JOIN LATERAL (
				SELECT ${tables.log.errorDetails} AS error_details,
					${tables.log.unifiedFinishReason} AS classification,
					${tables.log.finishReason} AS finish_reason,
					COALESCE(${tables.log.streamed}, false) AS streamed,
					${bucketExpr} AS bucket
				FROM ${tables.log}
				WHERE ${incidentErrorsPredicate}
					AND ${tables.log.usedProvider} = mappings.used_provider
					AND ${tables.log.usedModel} = mappings.used_model
					AND ${tables.log.createdAt} >= ${windowInterval}
					${sql.join(extraClauses, sql` `)}
				ORDER BY ${tables.log.createdAt} DESC
				LIMIT ${sampleLimit}
			) sampled
		),
		shape_models AS (
			SELECT status_code,
				status_text,
				response_text,
				cause,
				classification,
				used_provider,
				used_model,
				COUNT(*) AS count,
				COUNT(*) FILTER (WHERE streamed) AS streamed_count
			FROM recent_errors
			GROUP BY status_code, status_text, response_text, cause, classification, used_provider, used_model
		),
		shapes AS (
			SELECT status_code,
				status_text,
				response_text,
				cause,
				classification,
				SUM(count) AS count,
				SUM(streamed_count) AS streamed_count,
				json_agg(
					json_build_array(used_provider, used_model, count, streamed_count)
					ORDER BY count DESC, used_model
				) AS models
			FROM shape_models
			GROUP BY status_code, status_text, response_text, cause, classification
			ORDER BY count DESC, status_code, response_text
			LIMIT 50
		),
		shape_buckets AS (
			SELECT status_code,
				status_text,
				response_text,
				cause,
				classification,
				json_agg(json_build_array(bucket, count) ORDER BY bucket) AS buckets
			FROM (
				SELECT status_code,
					status_text,
					response_text,
					cause,
					classification,
					bucket,
					COUNT(*) AS count
				FROM recent_errors
				GROUP BY status_code, status_text, response_text, cause, classification, bucket
			) bucketed
			GROUP BY status_code, status_text, response_text, cause, classification
		)
		SELECT shapes.*,
			shape_buckets.buckets,
			(SELECT COUNT(*) FROM recent_errors) AS sampled_errors,
			(
				SELECT COUNT(*)
				FROM (
					SELECT 1
					FROM recent_errors
					GROUP BY used_provider, used_model
					HAVING COUNT(*) >= ${sampleLimit}
				) capped
			) AS capped_mappings
		FROM shapes
		JOIN shape_buckets
			ON (shapes.status_code, shapes.status_text, shapes.response_text, shapes.cause, shapes.classification)
				IS NOT DISTINCT FROM (shape_buckets.status_code, shape_buckets.status_text, shape_buckets.response_text, shape_buckets.cause, shape_buckets.classification)
		ORDER BY shapes.count DESC, shapes.status_code, shapes.response_text
	`);

	return {
		errors: rows.rows.map((r) => ({
			statusCode: r.status_code !== null ? Number(r.status_code) : null,
			statusText: r.status_text,
			responseText: r.response_text,
			cause: r.cause,
			classification: r.classification,
			count: Number(r.count),
			streamedCount: Number(r.streamed_count),
			models: r.models.map(([providerId, usedModel, count, streamedCount]) => ({
				providerId,
				usedModel,
				...parseUsedModel(usedModel, providerId),
				count: Number(count),
				streamedCount: Number(streamedCount),
			})),
			...(bucketSeconds !== undefined
				? {
						buckets: r.buckets.map(([start, count]) => ({
							start: Number(start),
							count: Number(count),
						})),
					}
				: {}),
		})),
		sampledErrors:
			rows.rows.length > 0 ? Number(rows.rows[0].sampled_errors) : 0,
		sampleLimit,
		cappedMappings:
			rows.rows.length > 0 ? Number(rows.rows[0].capped_mappings) : 0,
	};
}
