import { db, eq, globalAggregationState, log, sql } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";

import {
	formatUTCTimestamp,
	recalculateProjectHourlyModelStats,
	recalculateProjectHourlySourceModelStats,
} from "./project-stats-aggregator.js";

const ONE_HOUR_MS = 60 * 60 * 1000;
const PROJECT_BATCH_SIZE = 100;

function floorToHour(date: Date): Date {
	return new Date(Math.floor(date.getTime() / ONE_HOUR_MS) * ONE_HOUR_MS);
}

/**
 * Builds a backfill step that recalculates one stats table for the last `days`,
 * one hour per call, up to the hour the backfill first ran (the regular stats
 * refresh covers it from then on). The step returns true while hours remain.
 */
function createHourlyStatsBackfillStep({
	stateId,
	days,
	label,
	recalculate,
}: {
	stateId: string;
	days: number;
	label: string;
	recalculate: (projectIds: string[], hourTimestamp: string) => Promise<void>;
}) {
	return async function runStep(now = new Date()): Promise<boolean> {
		let state = await db.query.globalAggregationState.findFirst({
			where: { id: stateId },
		});
		if (!state) {
			const targetHour = floorToHour(now);
			const windowMs = days * 24 * ONE_HOUR_MS;
			await db
				.insert(globalAggregationState)
				.values({
					id: stateId,
					// Exclusive cursor: every hour before it is done.
					lastProcessedHour: new Date(targetHour.getTime() - windowMs),
					targetHour,
				})
				.onConflictDoNothing();
			state = await db.query.globalAggregationState.findFirst({
				where: { id: stateId },
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

		for (
			let offset = 0;
			offset < projects.length;
			offset += PROJECT_BATCH_SIZE
		) {
			await recalculate(
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
			.where(eq(globalAggregationState.id, stateId));

		if (projects.length > 0) {
			logger.info(`Backfilled ${label}`, {
				hour: hour.toISOString(),
				projects: projects.length,
			});
		}
		return nextHour < targetHour;
	};
}

const configuredBackfillDays = Number(
	process.env.SOURCE_MODEL_STATS_BACKFILL_DAYS,
);
export const SOURCE_MODEL_STATS_BACKFILL_DAYS =
	Number.isFinite(configuredBackfillDays) && configuredBackfillDays > 0
		? configuredBackfillDays
		: 365;

/** Backfills project_hourly_source_model_stats. */
export const runSourceModelStatsBackfillStep = createHourlyStatsBackfillStep({
	stateId: "source-model-stats-backfill",
	days: SOURCE_MODEL_STATS_BACKFILL_DAYS,
	label: "source model stats",
	recalculate: recalculateProjectHourlySourceModelStats,
});

/**
 * Fills project_hourly_model_stats' BYOK error columns over the longest
 * incidents window (3 days).
 */
export const runModelStatsByokErrorsBackfillStep =
	createHourlyStatsBackfillStep({
		stateId: "model-stats-byok-errors-backfill",
		days: 3,
		label: "model stats BYOK errors",
		recalculate: recalculateProjectHourlyModelStats,
	});
