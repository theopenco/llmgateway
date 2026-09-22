import { z } from "zod";

import { db, type SQL, sql, tables } from "@llmgateway/db";

// Selectable time windows, mapping each value to its SQL interval bound and an
// hours count surfaced to the UI.
export const MAPPING_ERROR_WINDOWS = {
	"1h": { interval: sql`now() - interval '1 hour'`, hours: 1 },
	"2h": { interval: sql`now() - interval '2 hours'`, hours: 2 },
	"4h": { interval: sql`now() - interval '4 hours'`, hours: 4 },
	"8h": { interval: sql`now() - interval '8 hours'`, hours: 8 },
	"12h": { interval: sql`now() - interval '12 hours'`, hours: 12 },
	"16h": { interval: sql`now() - interval '16 hours'`, hours: 16 },
	"24h": { interval: sql`now() - interval '24 hours'`, hours: 24 },
	"3d": { interval: sql`now() - interval '3 days'`, hours: 72 },
	"7d": { interval: sql`now() - interval '7 days'`, hours: 168 },
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
	// Streaming and non-streaming failures often have different causes, so the
	// drilldown groups errors by this flag.
	streamed: z.boolean(),
	count: z.number(),
});

export const mappingErrorShapesSchema = z.object({
	errors: z.array(mappingErrorShapeSchema),
	sampledErrors: z.number(),
});

/**
 * Top 10 error shapes over the latest non-client error logs of one mapping,
 * identified by the exact `log.used_model` value. Served by the partial
 * `log_error_used_provider_used_model_created_at_idx` index.
 */
export async function queryMappingErrorShapes({
	usedModel,
	provider,
	windowInterval,
	sampleLimit,
	extraClauses,
}: {
	usedModel: string;
	provider: string;
	windowInterval: SQL;
	sampleLimit: number;
	extraClauses: SQL[];
}): Promise<z.infer<typeof mappingErrorShapesSchema>> {
	const rows = await db.execute<{
		status_code: string | null;
		status_text: string | null;
		response_text: string | null;
		cause: string | null;
		classification: string | null;
		streamed: boolean;
		count: string;
		sampled_errors: string;
	}>(sql`
		WITH recent_errors AS (
			SELECT ${tables.log.errorDetails} AS error_details,
				${tables.log.unifiedFinishReason} AS classification,
				COALESCE(${tables.log.streamed}, false) AS streamed
			FROM ${tables.log}
			WHERE ${tables.log.hasError} = true
				AND ${tables.log.unifiedFinishReason} IS DISTINCT FROM 'client_error'
				AND ${tables.log.usedModel} = ${usedModel}
				AND ${tables.log.usedProvider} = ${provider}
				AND ${tables.log.createdAt} >= ${windowInterval}
				${sql.join(extraClauses, sql` `)}
			ORDER BY ${tables.log.createdAt} DESC
			LIMIT ${sampleLimit}
		)
		SELECT error_details->>'statusCode' AS status_code,
			error_details->>'statusText' AS status_text,
			LEFT(error_details->>'responseText', 2000) AS response_text,
			error_details->>'cause' AS cause,
			classification,
			streamed,
			COUNT(*) AS count,
			(SELECT COUNT(*) FROM recent_errors) AS sampled_errors
		FROM recent_errors
		GROUP BY status_code, status_text, response_text, cause, classification, streamed
		ORDER BY count DESC
		LIMIT 10
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
		})),
		sampledErrors,
	};
}
