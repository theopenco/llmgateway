import { db, eq, globalAggregationState, log, sql } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";

import {
	formatUTCTimestamp,
	recalculateProjectHourlyModelStats,
	recalculateBucket,
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
 *
 * `newestFirst` walks back from that hour instead, so the recent hours views
 * read most are fixed first. Its state reuses the columns with the bounds
 * swapped: `lastProcessedHour` is the exclusive upper cursor, `targetHour` the
 * oldest hour to reach.
 */
function createHourlyStatsBackfillStep({
	stateId,
	days,
	label,
	recalculate,
	newestFirst = false,
}: {
	stateId: string;
	days: number;
	label: string;
	recalculate: (projectIds: string[], hourTimestamp: string) => Promise<void>;
	newestFirst?: boolean;
}) {
	return async function runStep(now = new Date()): Promise<boolean> {
		let state = await db.query.globalAggregationState.findFirst({
			where: { id: stateId },
		});
		if (!state) {
			const startHour = floorToHour(now);
			const windowMs = days * 24 * ONE_HOUR_MS;
			const oldestHour = new Date(startHour.getTime() - windowMs);
			await db
				.insert(globalAggregationState)
				.values({
					id: stateId,
					// Exclusive cursor: every hour on its done side is processed.
					lastProcessedHour: newestFirst ? startHour : oldestHour,
					targetHour: newestFirst ? oldestHour : startHour,
				})
				.onConflictDoNothing();
			state = await db.query.globalAggregationState.findFirst({
				where: { id: stateId },
			});
		}

		const cursor = state?.lastProcessedHour;
		const targetHour = state?.targetHour;
		if (
			!cursor ||
			!targetHour ||
			(newestFirst ? cursor <= targetHour : cursor >= targetHour)
		) {
			return false;
		}
		const hour = newestFirst
			? new Date(cursor.getTime() - ONE_HOUR_MS)
			: cursor;

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

		const nextCursor = newestFirst
			? hour
			: new Date(hour.getTime() + ONE_HOUR_MS);
		await db
			.update(globalAggregationState)
			.set({ lastProcessedHour: nextCursor })
			.where(eq(globalAggregationState.id, stateId));

		if (projects.length > 0) {
			logger.info(`Backfilled ${label}`, {
				hour: hour.toISOString(),
				projects: projects.length,
			});
		}
		return newestFirst ? nextCursor > targetHour : nextCursor < targetHour;
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

const configuredTenantByokDays = Number(
	process.env.TENANT_STATS_BYOK_BACKFILL_DAYS,
);
/** Defaults to the longest admin Gateway Load window. */
export const TENANT_STATS_BYOK_BACKFILL_DAYS =
	Number.isFinite(configuredTenantByokDays) && configuredTenantByokDays > 0
		? configuredTenantByokDays
		: 365;

/**
 * Fills the BYOK error and latency columns of the project and API key hourly
 * (model) stats, so every Gateway Load metric can be split by billing mode.
 * Recalculates the whole bucket: rewriting project_hourly_stats bumps the
 * stale-bucket watermark, which would otherwise hide late logs from the
 * sibling tables.
 */
export const runTenantStatsByokSplitBackfillStep =
	createHourlyStatsBackfillStep({
		stateId: "tenant-stats-byok-split-backfill",
		days: TENANT_STATS_BYOK_BACKFILL_DAYS,
		label: "tenant stats BYOK split",
		recalculate: recalculateBucket,
		newestFirst: true,
	});
