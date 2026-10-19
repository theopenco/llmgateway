import {
	contentFilterHourlyErrorStats,
	db,
	eq,
	log,
	sql,
} from "@llmgateway/db";
import { logger } from "@llmgateway/logger";
import { getLogRetentionCutoff } from "@llmgateway/shared/log-retention";

import { formatUTCTimestamp } from "./project-stats-aggregator.js";

const UPSERT_CHUNK_SIZE = 1000;

interface ContentFilterErrorStatsRow extends Record<string, unknown> {
	organization_id: string;
	project_id: string;
	classifier: string;
	source: string;
	kind: string;
	input_type: string;
	status: number;
	code: string;
	error_count: number;
	last_message: string;
	last_request_id: string;
	last_seen_at: string;
}

type ContentFilterErrorStatsInsert =
	typeof contentFilterHourlyErrorStats.$inferInsert;

/**
 * Roll up one hour of failed moderation calls from
 * log.gatewayContentFilterEvaluation.moderationErrors into
 * contentFilterHourlyErrorStats. Scans a single hour of `log`, bounded by
 * created_at like the sibling content filter rollup. Provider retries copy the
 * evaluation onto every attempt, so each request's errors are counted once.
 */
export async function calculateContentFilterErrorStatsForHour(
	targetHour: Date,
) {
	const start = new Date(targetHour);
	start.setUTCMinutes(0, 0, 0);
	if (start < getLogRetentionCutoff()) {
		return { rows: 0 };
	}
	const startUtc = formatUTCTimestamp(start);

	const result = await db.execute<ContentFilterErrorStatsRow>(sql`
		with evaluations as (
			select distinct on (${log.requestId}, ${log.organizationId}, ${log.projectId})
				${log.requestId} as request_id,
				${log.organizationId} as organization_id,
				${log.projectId} as project_id,
				${log.createdAt} as created_at,
				coalesce(${log.gatewayContentFilterEvaluation} ->> 'classifier', 'openai') as classifier,
				${log.gatewayContentFilterEvaluation} -> 'moderationErrors' as errors
			from ${log}
			where ${log.createdAt} >= ${startUtc}::timestamp
				and ${log.createdAt} < ${startUtc}::timestamp + interval '1 hour'
				and ${log.gatewayContentFilterEvaluation} is not null
				and jsonb_typeof(${log.gatewayContentFilterEvaluation} -> 'moderationErrors') = 'array'
			order by ${log.requestId}, ${log.organizationId}, ${log.projectId}, ${log.createdAt} desc
		),
		errors as (
			select
				organization_id,
				project_id,
				request_id,
				created_at,
				classifier,
				coalesce(error ->> 'source', classifier) as source,
				coalesce(error ->> 'kind', 'unexpected') as kind,
				coalesce(error ->> 'inputType', '') as input_type,
				coalesce((error ->> 'status')::int, 0) as status,
				coalesce(error ->> 'code', '') as code,
				coalesce(error ->> 'message', '') as message
			from evaluations
			cross join lateral jsonb_array_elements(errors) as error
		)
		select
			organization_id,
			project_id,
			classifier,
			source,
			kind,
			input_type,
			status,
			code,
			count(*)::int as error_count,
			(array_agg(message order by created_at desc))[1] as last_message,
			(array_agg(request_id order by created_at desc))[1] as last_request_id,
			-- Zone-less UTC timestamp; spell out the zone so Node parses it as UTC.
			to_char(max(created_at), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as last_seen_at
		from errors
		group by organization_id, project_id, classifier, source, kind, input_type, status, code
	`);

	const values: ContentFilterErrorStatsInsert[] = result.rows.map((row) => ({
		hourTimestamp: start,
		organizationId: row.organization_id,
		projectId: row.project_id,
		classifier: row.classifier,
		source: row.source,
		kind: row.kind,
		inputType: row.input_type,
		status: Number(row.status),
		code: row.code,
		errorCount: Number(row.error_count),
		lastMessage: row.last_message,
		lastRequestId: row.last_request_id,
		lastSeenAt: new Date(row.last_seen_at),
	}));

	// Replace the hour so a bucket the recount no longer produces does not linger.
	await db.transaction(async (tx) => {
		await tx
			.delete(contentFilterHourlyErrorStats)
			.where(eq(contentFilterHourlyErrorStats.hourTimestamp, start));
		for (let i = 0; i < values.length; i += UPSERT_CHUNK_SIZE) {
			await tx
				.insert(contentFilterHourlyErrorStats)
				.values(values.slice(i, i + UPSERT_CHUNK_SIZE));
		}
	});

	logger.debug(
		`Recorded content filter error stats for ${start.toISOString()}`,
		{ rows: values.length },
	);

	return { rows: values.length };
}
