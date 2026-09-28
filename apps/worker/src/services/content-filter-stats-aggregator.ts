import {
	CONTENT_FILTER_STATS_ALL_CATEGORY,
	contentFilterHourlyModelStats,
	contentFilterHourlyStats,
	db,
	eq,
	log,
	sql,
} from "@llmgateway/db";
import { logger } from "@llmgateway/logger";
import { getLogRetentionCutoff } from "@llmgateway/shared/log-retention";

import { formatUTCTimestamp } from "./project-stats-aggregator.js";

const ONE_HOUR_MS = 60 * 60 * 1000;
const UPSERT_CHUNK_SIZE = 1000;

interface ContentFilterStatsRow extends Record<string, unknown> {
	organization_id: string;
	project_id: string;
	// Null on the per-(org, project) rows; log.usedModel itself is never null.
	used_model: string | null;
	used_provider: string | null;
	category: string;
	classifier: string;
	role: NonNullable<ContentFilterStatsInsert["role"]>;
	sampled_count: number;
	violation_count: number;
	blocked_count: number;
	duration_sum_ms: string | number;
	duration_count: number;
	duration_max_ms: number | null;
}

type ContentFilterStatsInsert = typeof contentFilterHourlyStats.$inferInsert;
type ContentFilterModelStatsInsert =
	typeof contentFilterHourlyModelStats.$inferInsert;

function hourWindow(targetHour: Date) {
	const start = new Date(targetHour);
	start.setUTCMinutes(0, 0, 0);
	return {
		start,
		end: new Date(start.getTime() + ONE_HOUR_MS),
		startUtc: formatUTCTimestamp(start),
	};
}

/**
 * Roll up one hour of tiered content filter evaluations from
 * log.gatewayContentFilterEvaluation into per-(org, project) totals plus one
 * row per violated moderation category, and the same broken out by the model
 * that served the request. Scans a single hour of `log`, like the routing
 * telemetry rollup; the admin dashboard only reads the hourly rows.
 * Provider retries write one row per attempt under the same request id with
 * the evaluation copied onto each, so counts are per request id. Evaluations
 * whose moderation call failed never scored anything, so they are left out of
 * sampledCount to keep the violation rate honest during an outage.
 *
 * Every row is keyed by classifier and role: the deciding classifier's verdict,
 * plus the shadow classifier's verdict on the same requests (never blocked).
 * The "all" rows also carry classifier durations, failed checks included, as
 * their latency still held the request.
 */
export async function calculateContentFilterStatsForHour(targetHour: Date) {
	const { start, startUtc } = hourWindow(targetHour);
	if (start < getLogRetentionCutoff()) {
		return { rows: 0, modelRows: 0 };
	}

	// One scan of the hour: both branches read the CTE, so Postgres materializes
	// it, and each branch groups by (org, project) and again by the model and
	// provider that served the request via grouping sets. used_model is null on
	// the (org, project) rows. A retried request is counted once per model it
	// touched.
	const result = await db.execute<ContentFilterStatsRow>(sql`
		with evaluations as (
			select
				${log.requestId} as request_id,
				${log.organizationId} as organization_id,
				${log.projectId} as project_id,
				${log.usedModel} as used_model,
				${log.usedProvider} as used_provider,
				evaluation.classifier,
				evaluation.violation,
				evaluation.action,
				evaluation."matchedCategories" as matched_categories,
				coalesce(evaluation."moderationFailed", false) as moderation_failed,
				evaluation."durationMs" as duration_ms,
				evaluation.shadow
			from ${log}
			cross join lateral jsonb_to_record(${log.gatewayContentFilterEvaluation}) as evaluation(
				classifier text,
				violation boolean,
				action text,
				"matchedCategories" jsonb,
				"moderationFailed" boolean,
				"durationMs" double precision,
				shadow jsonb
			)
			where ${log.createdAt} >= ${startUtc}::timestamp
				and ${log.createdAt} < ${startUtc}::timestamp + interval '1 hour'
				and ${log.gatewayContentFilterEvaluation} is not null
		),
		verdicts as (
			select
				request_id,
				organization_id,
				project_id,
				used_model,
				used_provider,
				verdict.*,
				-- Retries copy the evaluation onto every attempt: sum each request's
				-- duration once overall and once per model it touched.
				row_number() over (
					partition by organization_id, project_id, request_id, verdict.role
				) = 1 as first_for_request,
				row_number() over (
					partition by organization_id, project_id, request_id, verdict.role,
						used_model, used_provider
				) = 1 as first_for_model
			from evaluations
			cross join lateral (
				select
					coalesce(classifier, 'openai') as classifier,
					'deciding' as role,
					coalesce(violation, false) as violation,
					action = 'blocked' as blocked,
					matched_categories,
					moderation_failed,
					round(duration_ms)::bigint as duration_ms
				union all
				select
					shadow->>'classifier',
					'shadow',
					coalesce((shadow->>'violation')::boolean, false),
					false,
					shadow->'matchedCategories',
					coalesce((shadow->>'moderationFailed')::boolean, false),
					round((shadow->>'durationMs')::double precision)::bigint
				where shadow is not null and shadow->>'classifier' is not null
			) as verdict
		)
		select
			organization_id,
			project_id,
			used_model,
			used_provider,
			${CONTENT_FILTER_STATS_ALL_CATEGORY} as category,
			classifier,
			role,
			count(distinct request_id) filter (where not moderation_failed)::int as sampled_count,
			count(distinct request_id) filter (where violation)::int as violation_count,
			count(distinct request_id) filter (where blocked)::int as blocked_count,
			coalesce(
				case when grouping(used_model) = 1
					then sum(duration_ms) filter (where first_for_request)
					else sum(duration_ms) filter (where first_for_model)
				end,
				0
			)::bigint as duration_sum_ms,
			count(distinct request_id) filter (where duration_ms is not null)::int as duration_count,
			max(duration_ms)::int as duration_max_ms
		from verdicts
		group by grouping sets (
			(organization_id, project_id, classifier, role),
			(organization_id, project_id, used_model, used_provider, classifier, role)
		)
		union all
		select
			organization_id,
			project_id,
			used_model,
			used_provider,
			category,
			classifier,
			role,
			0 as sampled_count,
			count(distinct request_id)::int as violation_count,
			0 as blocked_count,
			0::bigint as duration_sum_ms,
			0 as duration_count,
			null::int as duration_max_ms
		from verdicts
		cross join lateral jsonb_array_elements_text(
			coalesce(matched_categories, '[]'::jsonb)
		) as category
		where violation
		group by grouping sets (
			(organization_id, project_id, classifier, role, category),
			(organization_id, project_id, used_model, used_provider, classifier, role, category)
		)
	`);

	const values: ContentFilterStatsInsert[] = [];
	const modelValues: ContentFilterModelStatsInsert[] = [];
	for (const row of result.rows) {
		const counts: ContentFilterStatsInsert = {
			hourTimestamp: start,
			organizationId: row.organization_id,
			projectId: row.project_id,
			category: row.category,
			classifier: row.classifier,
			role: row.role,
			sampledCount: Number(row.sampled_count),
			violationCount: Number(row.violation_count),
			blockedCount: Number(row.blocked_count),
			durationSumMs: Number(row.duration_sum_ms),
			durationCount: Number(row.duration_count),
			durationMaxMs:
				row.duration_max_ms === null ? null : Number(row.duration_max_ms),
		};
		if (row.used_model === null || row.used_provider === null) {
			values.push(counts);
		} else {
			modelValues.push({
				...counts,
				usedModel: row.used_model,
				usedProvider: row.used_provider,
			});
		}
	}

	// Replace the hour rather than only upserting it: a key the recount no longer
	// produces would otherwise linger, such as a row the pre-classifier rollup
	// wrote under the "openai" column default for requests another classifier
	// actually decided.
	await db.transaction(async (tx) => {
		await tx
			.delete(contentFilterHourlyStats)
			.where(eq(contentFilterHourlyStats.hourTimestamp, start));
		await tx
			.delete(contentFilterHourlyModelStats)
			.where(eq(contentFilterHourlyModelStats.hourTimestamp, start));

		for (let i = 0; i < values.length; i += UPSERT_CHUNK_SIZE) {
			await tx
				.insert(contentFilterHourlyStats)
				.values(values.slice(i, i + UPSERT_CHUNK_SIZE))
				.onConflictDoUpdate({
					target: [
						contentFilterHourlyStats.hourTimestamp,
						contentFilterHourlyStats.organizationId,
						contentFilterHourlyStats.projectId,
						contentFilterHourlyStats.category,
						contentFilterHourlyStats.classifier,
						contentFilterHourlyStats.role,
					],
					set: {
						sampledCount: sql`excluded.sampled_count`,
						violationCount: sql`excluded.violation_count`,
						blockedCount: sql`excluded.blocked_count`,
						durationSumMs: sql`excluded.duration_sum_ms`,
						durationCount: sql`excluded.duration_count`,
						durationMaxMs: sql`excluded.duration_max_ms`,
						updatedAt: new Date(),
					},
				});
		}

		for (let i = 0; i < modelValues.length; i += UPSERT_CHUNK_SIZE) {
			await tx
				.insert(contentFilterHourlyModelStats)
				.values(modelValues.slice(i, i + UPSERT_CHUNK_SIZE))
				.onConflictDoUpdate({
					target: [
						contentFilterHourlyModelStats.hourTimestamp,
						contentFilterHourlyModelStats.organizationId,
						contentFilterHourlyModelStats.projectId,
						contentFilterHourlyModelStats.usedModel,
						contentFilterHourlyModelStats.usedProvider,
						contentFilterHourlyModelStats.category,
						contentFilterHourlyModelStats.classifier,
						contentFilterHourlyModelStats.role,
					],
					set: {
						sampledCount: sql`excluded.sampled_count`,
						violationCount: sql`excluded.violation_count`,
						blockedCount: sql`excluded.blocked_count`,
						durationSumMs: sql`excluded.duration_sum_ms`,
						durationCount: sql`excluded.duration_count`,
						durationMaxMs: sql`excluded.duration_max_ms`,
						updatedAt: new Date(),
					},
				});
		}
	});

	logger.debug(`Recorded content filter stats for ${start.toISOString()}`, {
		rows: values.length,
		modelRows: modelValues.length,
	});

	return { rows: values.length, modelRows: modelValues.length };
}
