import {
	db,
	log,
	projectHourlyStats,
	projectHourlyModelStats,
	sql,
	gte,
	lt,
	and,
} from "@llmgateway/db";
import { logger } from "@llmgateway/logger";

// Configuration for project stats refresh interval (defaults to 60 seconds)
export const PROJECT_STATS_REFRESH_INTERVAL_SECONDS =
	Number(process.env.PROJECT_STATS_REFRESH_INTERVAL_SECONDS) || 60;

// Configuration for backfill duration in hours (defaults to 24 hours)
const PROJECT_STATS_BACKFILL_HOURS =
	Number(process.env.PROJECT_STATS_BACKFILL_HOURS) || 24;

/**
 * Helper function to round any date to the start of its hour (00 minutes, 00 seconds, 00 milliseconds)
 */
function roundToHourStart(date: Date): Date {
	return new Date(
		date.getFullYear(),
		date.getMonth(),
		date.getDate(),
		date.getHours(),
		0,
		0,
		0,
	);
}

/**
 * Helper function to get the current hour start
 */
function getCurrentHourStart(): Date {
	return roundToHourStart(new Date());
}

/**
 * Helper function to get the previous hour start
 */
function getPreviousHourStart(): Date {
	const currentHour = getCurrentHourStart();
	return new Date(currentHour.getTime() - 60 * 60 * 1000);
}

/**
 * Calculate and store hourly statistics for all projects for a specific hour
 * @param targetHour The specific hour to calculate stats for
 */
async function calculateProjectHourlyStatsForHour(targetHour: Date) {
	const roundedTargetHour = roundToHourStart(targetHour);
	const hourEnd = new Date(roundedTargetHour.getTime() + 60 * 60 * 1000);
	const database = db;

	logger.debug(
		`Calculating project hourly stats for ${roundedTargetHour.toISOString()}`,
	);

	// Aggregate logs by project for this hour
	const projectStats = await database
		.select({
			projectId: log.projectId,
			requestCount: sql<number>`count(*)::int`.as("requestCount"),
			errorCount:
				sql<number>`sum(case when ${log.hasError} = true then 1 else 0 end)::int`.as(
					"errorCount",
				),
			cacheCount:
				sql<number>`sum(case when ${log.cached} = true then 1 else 0 end)::int`.as(
					"cacheCount",
				),
			inputTokens:
				sql<string>`coalesce(sum(cast(${log.promptTokens} as numeric)), 0)`.as(
					"inputTokens",
				),
			outputTokens:
				sql<string>`coalesce(sum(cast(${log.completionTokens} as numeric)), 0)`.as(
					"outputTokens",
				),
			totalTokens:
				sql<string>`coalesce(sum(cast(${log.totalTokens} as numeric)), 0)`.as(
					"totalTokens",
				),
			reasoningTokens:
				sql<string>`coalesce(sum(cast(${log.reasoningTokens} as numeric)), 0)`.as(
					"reasoningTokens",
				),
			cachedTokens:
				sql<string>`coalesce(sum(cast(${log.cachedTokens} as numeric)), 0)`.as(
					"cachedTokens",
				),
			cost: sql<number>`coalesce(sum(${log.cost}), 0)`.as("cost"),
			inputCost: sql<number>`coalesce(sum(${log.inputCost}), 0)`.as(
				"inputCost",
			),
			outputCost: sql<number>`coalesce(sum(${log.outputCost}), 0)`.as(
				"outputCost",
			),
			requestCost: sql<number>`coalesce(sum(${log.requestCost}), 0)`.as(
				"requestCost",
			),
			dataStorageCost:
				sql<number>`coalesce(sum(cast(${log.dataStorageCost} as real)), 0)`.as(
					"dataStorageCost",
				),
			serviceFee: sql<number>`coalesce(sum(${log.serviceFee}), 0)`.as(
				"serviceFee",
			),
			discountSavings: sql<number>`coalesce(
				sum(
					case
						when ${log.discount} > 0 and ${log.discount} < 1
						then ${log.cost} * ${log.discount} / (1 - ${log.discount})
						else 0
					end
				),
				0
			)`.as("discountSavings"),
		})
		.from(log)
		.where(
			and(gte(log.createdAt, roundedTargetHour), lt(log.createdAt, hourEnd)),
		)
		.groupBy(log.projectId);

	// Upsert project hourly stats
	for (const stat of projectStats) {
		await database
			.insert(projectHourlyStats)
			.values({
				projectId: stat.projectId,
				hourTimestamp: roundedTargetHour,
				requestCount: stat.requestCount,
				errorCount: stat.errorCount,
				cacheCount: stat.cacheCount,
				inputTokens: stat.inputTokens,
				outputTokens: stat.outputTokens,
				totalTokens: stat.totalTokens,
				reasoningTokens: stat.reasoningTokens,
				cachedTokens: stat.cachedTokens,
				cost: stat.cost,
				inputCost: stat.inputCost,
				outputCost: stat.outputCost,
				requestCost: stat.requestCost,
				dataStorageCost: stat.dataStorageCost,
				serviceFee: stat.serviceFee,
				discountSavings: stat.discountSavings,
			})
			.onConflictDoUpdate({
				target: [
					projectHourlyStats.projectId,
					projectHourlyStats.hourTimestamp,
				],
				set: {
					requestCount: stat.requestCount,
					errorCount: stat.errorCount,
					cacheCount: stat.cacheCount,
					inputTokens: stat.inputTokens,
					outputTokens: stat.outputTokens,
					totalTokens: stat.totalTokens,
					reasoningTokens: stat.reasoningTokens,
					cachedTokens: stat.cachedTokens,
					cost: stat.cost,
					inputCost: stat.inputCost,
					outputCost: stat.outputCost,
					requestCost: stat.requestCost,
					dataStorageCost: stat.dataStorageCost,
					serviceFee: stat.serviceFee,
					discountSavings: stat.discountSavings,
					updatedAt: new Date(),
				},
			});
	}

	return projectStats.length;
}

/**
 * Calculate and store hourly model statistics for all projects for a specific hour
 * @param targetHour The specific hour to calculate stats for
 */
async function calculateProjectHourlyModelStatsForHour(targetHour: Date) {
	const roundedTargetHour = roundToHourStart(targetHour);
	const hourEnd = new Date(roundedTargetHour.getTime() + 60 * 60 * 1000);
	const database = db;

	logger.debug(
		`Calculating project hourly model stats for ${roundedTargetHour.toISOString()}`,
	);

	// Aggregate logs by project, model, and provider for this hour
	const modelStats = await database
		.select({
			projectId: log.projectId,
			usedModel: log.usedModel,
			usedProvider: log.usedProvider,
			requestCount: sql<number>`count(*)::int`.as("requestCount"),
			errorCount:
				sql<number>`sum(case when ${log.hasError} = true then 1 else 0 end)::int`.as(
					"errorCount",
				),
			cacheCount:
				sql<number>`sum(case when ${log.cached} = true then 1 else 0 end)::int`.as(
					"cacheCount",
				),
			inputTokens:
				sql<string>`coalesce(sum(cast(${log.promptTokens} as numeric)), 0)`.as(
					"inputTokens",
				),
			outputTokens:
				sql<string>`coalesce(sum(cast(${log.completionTokens} as numeric)), 0)`.as(
					"outputTokens",
				),
			totalTokens:
				sql<string>`coalesce(sum(cast(${log.totalTokens} as numeric)), 0)`.as(
					"totalTokens",
				),
			cost: sql<number>`coalesce(sum(${log.cost}), 0)`.as("cost"),
			inputCost: sql<number>`coalesce(sum(${log.inputCost}), 0)`.as(
				"inputCost",
			),
			outputCost: sql<number>`coalesce(sum(${log.outputCost}), 0)`.as(
				"outputCost",
			),
		})
		.from(log)
		.where(
			and(gte(log.createdAt, roundedTargetHour), lt(log.createdAt, hourEnd)),
		)
		.groupBy(log.projectId, log.usedModel, log.usedProvider);

	// Upsert project hourly model stats
	for (const stat of modelStats) {
		await database
			.insert(projectHourlyModelStats)
			.values({
				projectId: stat.projectId,
				hourTimestamp: roundedTargetHour,
				usedModel: stat.usedModel,
				usedProvider: stat.usedProvider,
				requestCount: stat.requestCount,
				errorCount: stat.errorCount,
				cacheCount: stat.cacheCount,
				inputTokens: stat.inputTokens,
				outputTokens: stat.outputTokens,
				totalTokens: stat.totalTokens,
				cost: stat.cost,
				inputCost: stat.inputCost,
				outputCost: stat.outputCost,
			})
			.onConflictDoUpdate({
				target: [
					projectHourlyModelStats.projectId,
					projectHourlyModelStats.hourTimestamp,
					projectHourlyModelStats.usedModel,
					projectHourlyModelStats.usedProvider,
				],
				set: {
					requestCount: stat.requestCount,
					errorCount: stat.errorCount,
					cacheCount: stat.cacheCount,
					inputTokens: stat.inputTokens,
					outputTokens: stat.outputTokens,
					totalTokens: stat.totalTokens,
					cost: stat.cost,
					inputCost: stat.inputCost,
					outputCost: stat.outputCost,
					updatedAt: new Date(),
				},
			});
	}

	return modelStats.length;
}

/**
 * Refresh project hourly stats for the current hour and previous hour
 * Previous hour is also refreshed to handle logs that arrived just after the hour boundary
 */
export async function refreshProjectHourlyStats() {
	const currentHour = getCurrentHourStart();
	const previousHour = getPreviousHourStart();

	logger.debug("Starting project hourly stats refresh...");

	try {
		// Refresh current hour (for real-time data)
		const currentProjectCount =
			await calculateProjectHourlyStatsForHour(currentHour);
		const currentModelCount =
			await calculateProjectHourlyModelStatsForHour(currentHour);

		// Refresh previous hour (to catch late-arriving logs)
		const previousProjectCount =
			await calculateProjectHourlyStatsForHour(previousHour);
		const previousModelCount =
			await calculateProjectHourlyModelStatsForHour(previousHour);

		logger.debug(
			`Project hourly stats refresh complete. Current hour: ${currentProjectCount} projects, ${currentModelCount} model entries. Previous hour: ${previousProjectCount} projects, ${previousModelCount} model entries.`,
		);
	} catch (error) {
		logger.error(
			"Error refreshing project hourly stats",
			error instanceof Error ? error : new Error(String(error)),
		);
		throw error;
	}
}

/**
 * Backfill project hourly stats for missing hours
 * Called on worker startup
 */
export async function backfillProjectHourlyStatsIfNeeded() {
	logger.info("Checking for missing project hourly stats to backfill...");

	try {
		const database = db;

		// Get the most recent hourly stats entry
		const latestStats = await database
			.select({ hourTimestamp: projectHourlyStats.hourTimestamp })
			.from(projectHourlyStats)
			.orderBy(sql`${projectHourlyStats.hourTimestamp} DESC`)
			.limit(1);

		const previousHour = getPreviousHourStart();
		const backfillStartHour = new Date(
			Date.now() - PROJECT_STATS_BACKFILL_HOURS * 60 * 60 * 1000,
		);
		const backfillStartRounded = roundToHourStart(backfillStartHour);

		let startFromHour: Date;

		if (latestStats.length === 0) {
			// No existing stats, start from backfill start
			logger.info(
				`No existing project hourly stats found. Starting backfill from ${backfillStartRounded.toISOString()}`,
			);
			startFromHour = backfillStartRounded;
		} else {
			const lastHour = latestStats[0]!.hourTimestamp;
			const hoursBehind = Math.floor(
				(previousHour.getTime() - lastHour.getTime()) / (60 * 60 * 1000),
			);

			if (hoursBehind > 1) {
				// We're missing some hours, backfill from after the last recorded hour
				logger.info(
					`Found gap of ${hoursBehind} hours. Backfilling from ${lastHour.toISOString()}`,
				);
				startFromHour = new Date(lastHour.getTime() + 60 * 60 * 1000);
			} else {
				logger.info(
					`Project hourly stats are up to date. Last entry: ${lastHour.toISOString()}`,
				);
				return;
			}
		}

		// Backfill each missing hour
		let hour = startFromHour;
		let hoursProcessed = 0;
		const maxHours = PROJECT_STATS_BACKFILL_HOURS + 1; // Safety limit

		while (hour <= previousHour && hoursProcessed < maxHours) {
			const projectCount = await calculateProjectHourlyStatsForHour(hour);
			const modelCount = await calculateProjectHourlyModelStatsForHour(hour);

			logger.info(
				`Backfilled project hourly stats for ${hour.toISOString()}: ${projectCount} projects, ${modelCount} model entries`,
			);

			hour = new Date(hour.getTime() + 60 * 60 * 1000);
			hoursProcessed++;
		}

		if (hoursProcessed >= maxHours) {
			logger.warn(
				`Backfill stopped at limit of ${maxHours} hours to prevent excessive processing`,
			);
		}

		logger.info(
			`Project hourly stats backfill complete. Processed ${hoursProcessed} hours.`,
		);
	} catch (error) {
		logger.error(
			"Error during project hourly stats backfill",
			error instanceof Error ? error : new Error(String(error)),
		);
		throw error;
	}
}
