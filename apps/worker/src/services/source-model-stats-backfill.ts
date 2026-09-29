import { db, eq, globalAggregationState, log, sql } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";

import {
	formatUTCTimestamp,
	recalculateProjectHourlySourceModelStats,
} from "./project-stats-aggregator.js";

const ONE_HOUR_MS = 60 * 60 * 1000;
const PROJECT_BATCH_SIZE = 100;
const STATE_ID = "source-model-stats-backfill";

export const SOURCE_MODEL_STATS_BACKFILL_DAYS = Number(
	process.env.SOURCE_MODEL_STATS_BACKFILL_DAYS ?? 365,
);

function floorToHour(date: Date): Date {
	return new Date(Math.floor(date.getTime() / ONE_HOUR_MS) * ONE_HOUR_MS);
}

/**
 * Backfills project_hourly_source_model_stats for the last
 * SOURCE_MODEL_STATS_BACKFILL_DAYS, one hour per call, up to the hour the
 * backfill first ran (the regular stats refresh covers it from then on).
 * Returns true while hours remain.
 */
export async function runSourceModelStatsBackfillStep(
	now = new Date(),
): Promise<boolean> {
	let state = await db.query.globalAggregationState.findFirst({
		where: { id: STATE_ID },
	});
	if (!state) {
		const targetHour = floorToHour(now);
		const windowMs = SOURCE_MODEL_STATS_BACKFILL_DAYS * 24 * ONE_HOUR_MS;
		await db
			.insert(globalAggregationState)
			.values({
				id: STATE_ID,
				// Exclusive cursor: every hour before it is done.
				lastProcessedHour: new Date(targetHour.getTime() - windowMs),
				targetHour,
			})
			.onConflictDoNothing();
		state = await db.query.globalAggregationState.findFirst({
			where: { id: STATE_ID },
		});
	}

	const hour = state?.lastProcessedHour;
	const targetHour = state?.targetHour;
	if (!hour || !targetHour || hour >= targetHour) {
		return false;
	}

	const hourStart = formatUTCTimestamp(hour);
	const projects = await db
		.select({ projectId: log.projectId })
		.from(log)
		.where(
			sql`${log.createdAt} >= ${hourStart}::timestamp AND ${log.createdAt} < ${hourStart}::timestamp + interval '1 hour'`,
		)
		.groupBy(log.projectId);

	for (let offset = 0; offset < projects.length; offset += PROJECT_BATCH_SIZE) {
		await recalculateProjectHourlySourceModelStats(
			projects
				.slice(offset, offset + PROJECT_BATCH_SIZE)
				.map(({ projectId }) => projectId),
			hourStart,
		);
	}

	const nextHour = new Date(hour.getTime() + ONE_HOUR_MS);
	await db
		.update(globalAggregationState)
		.set({ lastProcessedHour: nextHour })
		.where(eq(globalAggregationState.id, STATE_ID));

	if (projects.length > 0) {
		logger.info("Backfilled source model stats", {
			hour: hour.toISOString(),
			projects: projects.length,
		});
	}
	return nextHour < targetHour;
}
