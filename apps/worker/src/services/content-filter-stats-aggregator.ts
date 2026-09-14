import {
	CONTENT_FILTER_STATS_ALL_CATEGORY,
	contentFilterHourlyModelStats,
	contentFilterHourlyStats,
	db,
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
	category: string;
	sampled_count: number;
	violation_count: number;
	blocked_count: number;
}

interface ContentFilterModelStatsRow extends ContentFilterStatsRow {
	used_model: string;
	used_provider: string;
}

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
 */
export async function calculateContentFilterStatsForHour(targetHour: Date) {
	const { start, startUtc } = hourWindow(targetHour);
	if (start < getLogRetentionCutoff()) {
		return { rows: 0, modelRows: 0 };
	}

	const evaluations = sql`
		select
			${log.requestId} as request_id,
			${log.organizationId} as organization_id,
			${log.projectId} as project_id,
			${log.usedModel} as used_model,
			${log.usedProvider} as used_provider,
			evaluation.violation,
			evaluation.action,
			evaluation."matchedCategories" as matched_categories,
			coalesce(evaluation."moderationFailed", false) as moderation_failed
		from ${log}
		cross join lateral jsonb_to_record(${log.gatewayContentFilterEvaluation}) as evaluation(
			violation boolean,
			action text,
			"matchedCategories" jsonb,
			"moderationFailed" boolean
		)
		where ${log.createdAt} >= ${startUtc}::timestamp
			and ${log.createdAt} < ${startUtc}::timestamp + interval '1 hour'
			and ${log.gatewayContentFilterEvaluation} is not null
	`;

	const result = await db.execute<ContentFilterStatsRow>(sql`
		with evaluations as (${evaluations})
		select
			organization_id,
			project_id,
			${CONTENT_FILTER_STATS_ALL_CATEGORY} as category,
			count(distinct request_id) filter (where not moderation_failed)::int as sampled_count,
			count(distinct request_id) filter (where violation)::int as violation_count,
			count(distinct request_id) filter (where action = 'blocked')::int as blocked_count
		from evaluations
		group by organization_id, project_id
		union all
		select
			organization_id,
			project_id,
			category,
			0 as sampled_count,
			count(distinct request_id)::int as violation_count,
			0 as blocked_count
		from evaluations
		cross join lateral jsonb_array_elements_text(
			coalesce(matched_categories, '[]'::jsonb)
		) as category
		where violation
		group by organization_id, project_id, category
	`);

	// Same shape, keyed additionally by the model/provider that served the
	// request. A retried request is counted once per model it touched.
	const modelResult = await db.execute<ContentFilterModelStatsRow>(sql`
		with evaluations as (${evaluations})
		select
			organization_id,
			project_id,
			used_model,
			used_provider,
			${CONTENT_FILTER_STATS_ALL_CATEGORY} as category,
			count(distinct request_id) filter (where not moderation_failed)::int as sampled_count,
			count(distinct request_id) filter (where violation)::int as violation_count,
			count(distinct request_id) filter (where action = 'blocked')::int as blocked_count
		from evaluations
		group by organization_id, project_id, used_model, used_provider
		union all
		select
			organization_id,
			project_id,
			used_model,
			used_provider,
			category,
			0 as sampled_count,
			count(distinct request_id)::int as violation_count,
			0 as blocked_count
		from evaluations
		cross join lateral jsonb_array_elements_text(
			coalesce(matched_categories, '[]'::jsonb)
		) as category
		where violation
		group by organization_id, project_id, used_model, used_provider, category
	`);

	const values = result.rows.map((row) => ({
		hourTimestamp: start,
		organizationId: row.organization_id,
		projectId: row.project_id,
		category: row.category,
		sampledCount: Number(row.sampled_count),
		violationCount: Number(row.violation_count),
		blockedCount: Number(row.blocked_count),
	}));

	for (let i = 0; i < values.length; i += UPSERT_CHUNK_SIZE) {
		await db
			.insert(contentFilterHourlyStats)
			.values(values.slice(i, i + UPSERT_CHUNK_SIZE))
			.onConflictDoUpdate({
				target: [
					contentFilterHourlyStats.hourTimestamp,
					contentFilterHourlyStats.organizationId,
					contentFilterHourlyStats.projectId,
					contentFilterHourlyStats.category,
				],
				set: {
					sampledCount: sql`excluded.sampled_count`,
					violationCount: sql`excluded.violation_count`,
					blockedCount: sql`excluded.blocked_count`,
					updatedAt: new Date(),
				},
			});
	}

	const modelValues = modelResult.rows.map((row) => ({
		hourTimestamp: start,
		organizationId: row.organization_id,
		projectId: row.project_id,
		usedModel: row.used_model,
		usedProvider: row.used_provider,
		category: row.category,
		sampledCount: Number(row.sampled_count),
		violationCount: Number(row.violation_count),
		blockedCount: Number(row.blocked_count),
	}));

	for (let i = 0; i < modelValues.length; i += UPSERT_CHUNK_SIZE) {
		await db
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
				],
				set: {
					sampledCount: sql`excluded.sampled_count`,
					violationCount: sql`excluded.violation_count`,
					blockedCount: sql`excluded.blocked_count`,
					updatedAt: new Date(),
				},
			});
	}

	logger.debug(`Recorded content filter stats for ${start.toISOString()}`, {
		rows: values.length,
		modelRows: modelValues.length,
	});

	return { rows: values.length, modelRows: modelValues.length };
}
