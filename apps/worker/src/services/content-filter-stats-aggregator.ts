import {
	CONTENT_FILTER_STATS_ALL_CATEGORY,
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
 * row per violated moderation category. Scans a single hour of `log`, like the
 * routing telemetry rollup; the admin dashboard only reads the hourly rows.
 */
export async function calculateContentFilterStatsForHour(targetHour: Date) {
	const { start, startUtc } = hourWindow(targetHour);
	if (start < getLogRetentionCutoff()) {
		return { rows: 0 };
	}

	const result = await db.execute<ContentFilterStatsRow>(sql`
		with evaluations as (
			select
				${log.organizationId} as organization_id,
				${log.projectId} as project_id,
				evaluation.violation,
				evaluation.action,
				evaluation."matchedCategories" as matched_categories
			from ${log}
			cross join lateral jsonb_to_record(${log.gatewayContentFilterEvaluation}) as evaluation(
				violation boolean,
				action text,
				"matchedCategories" jsonb
			)
			where ${log.createdAt} >= ${startUtc}::timestamp
				and ${log.createdAt} < ${startUtc}::timestamp + interval '1 hour'
				and ${log.gatewayContentFilterEvaluation} is not null
		)
		select
			organization_id,
			project_id,
			${CONTENT_FILTER_STATS_ALL_CATEGORY} as category,
			count(*)::int as sampled_count,
			count(*) filter (where violation)::int as violation_count,
			count(*) filter (where action = 'blocked')::int as blocked_count
		from evaluations
		group by organization_id, project_id
		union all
		select
			organization_id,
			project_id,
			category,
			0 as sampled_count,
			count(*)::int as violation_count,
			0 as blocked_count
		from evaluations
		cross join lateral jsonb_array_elements_text(
			coalesce(matched_categories, '[]'::jsonb)
		) as category
		where violation
		group by organization_id, project_id, category
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

	logger.debug(`Recorded content filter stats for ${start.toISOString()}`, {
		rows: values.length,
	});

	return { rows: values.length };
}
