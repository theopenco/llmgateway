import { db, provider, model, modelProviderMapping, log } from "@llmgateway/db";
import { sql, eq, gte, and } from "drizzle-orm";

export async function calculateUsageStatistics() {
	console.log("Starting usage statistics calculation...");

	try {
		const database = db;
		const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

		const providerStats = await database
			.select({
				providerId: log.usedProvider,
				logsCount: sql<number>`count(*)::int`.as("logsCount"),
				errorsCount:
					sql<number>`sum(case when ${log.hasError} = true then 1 else 0 end)::int`.as(
						"errorsCount",
					),
				totalOutputTokens: sql<number>`sum(${log.completionTokens})`.as(
					"totalOutputTokens",
				),
				totalDuration: sql<number>`sum(${log.duration})`.as("totalDuration"),
			})
			.from(log)
			.where(gte(log.createdAt, fiveMinutesAgo))
			.groupBy(log.usedProvider);

		for (const stat of providerStats) {
			if (!stat.providerId) {
				continue;
			}

			const errorRate =
				stat.logsCount > 0 ? (stat.errorsCount / stat.logsCount) * 100 : 0;
			const throughput =
				stat.totalDuration > 0
					? (Number(stat.totalOutputTokens || 0) / stat.totalDuration) * 1000
					: 0;

			await database
				.update(provider)
				.set({
					logsCount: stat.logsCount,
					errorsCount: stat.errorsCount,
					errorRate,
					throughput,
					statsUpdatedAt: new Date(),
					updatedAt: new Date(),
				})
				.where(eq(provider.id, stat.providerId));
		}

		console.log(`Updated statistics for ${providerStats.length} providers`);

		const modelStats = await database
			.select({
				modelId: log.usedModel,
				logsCount: sql<number>`count(*)::int`.as("logsCount"),
				errorsCount:
					sql<number>`sum(case when ${log.hasError} = true then 1 else 0 end)::int`.as(
						"errorsCount",
					),
				totalOutputTokens: sql<number>`sum(${log.completionTokens})`.as(
					"totalOutputTokens",
				),
				totalDuration: sql<number>`sum(${log.duration})`.as("totalDuration"),
			})
			.from(log)
			.where(gte(log.createdAt, fiveMinutesAgo))
			.groupBy(log.usedModel);

		for (const stat of modelStats) {
			if (!stat.modelId) {
				continue;
			}

			const errorRate =
				stat.logsCount > 0 ? (stat.errorsCount / stat.logsCount) * 100 : 0;
			const throughput =
				stat.totalDuration > 0
					? (Number(stat.totalOutputTokens || 0) / stat.totalDuration) * 1000
					: 0;

			await database
				.update(model)
				.set({
					logsCount: stat.logsCount,
					errorsCount: stat.errorsCount,
					errorRate,
					throughput,
					statsUpdatedAt: new Date(),
					updatedAt: new Date(),
				})
				.where(eq(model.id, stat.modelId));
		}

		console.log(`Updated statistics for ${modelStats.length} models`);

		const mappingStats = await database
			.select({
				modelId: log.usedModel,
				providerId: log.usedProvider,
				logsCount: sql<number>`count(*)::int`.as("logsCount"),
				errorsCount:
					sql<number>`sum(case when ${log.hasError} = true then 1 else 0 end)::int`.as(
						"errorsCount",
					),
				totalOutputTokens: sql<number>`sum(${log.completionTokens})`.as(
					"totalOutputTokens",
				),
				totalDuration: sql<number>`sum(${log.duration})`.as("totalDuration"),
			})
			.from(log)
			.where(gte(log.createdAt, fiveMinutesAgo))
			.groupBy(log.usedModel, log.usedProvider);

		for (const stat of mappingStats) {
			if (!stat.modelId || !stat.providerId) {
				continue;
			}

			const mappings = await database
				.select()
				.from(modelProviderMapping)
				.where(
					and(
						eq(modelProviderMapping.modelId, stat.modelId),
						eq(modelProviderMapping.providerId, stat.providerId),
					),
				)
				.limit(1);
			const existingMapping = mappings[0];

			if (existingMapping) {
				const errorRate =
					stat.logsCount > 0 ? (stat.errorsCount / stat.logsCount) * 100 : 0;
				const throughput =
					stat.totalDuration > 0
						? (Number(stat.totalOutputTokens || 0) / stat.totalDuration) * 1000
						: 0;

				await database
					.update(modelProviderMapping)
					.set({
						logsCount: stat.logsCount,
						errorsCount: stat.errorsCount,
						errorRate,
						throughput,
						statsUpdatedAt: new Date(),
						updatedAt: new Date(),
					})
					.where(eq(modelProviderMapping.id, existingMapping.id));
			}
		}

		console.log(
			`Updated statistics for ${mappingStats.length} model-provider mappings`,
		);
		console.log("Usage statistics calculation completed successfully");
	} catch (error) {
		console.error("Error calculating usage statistics:", error);
	}
}

let intervalId: NodeJS.Timeout | null = null;

export function startStatsCalculator() {
	console.log("Starting statistics calculator (runs every 5 minutes)...");

	void calculateUsageStatistics();

	intervalId = setInterval(
		() => {
			void calculateUsageStatistics();
		},
		5 * 60 * 1000,
	);
}

export function stopStatsCalculator() {
	if (intervalId) {
		clearInterval(intervalId);
		intervalId = null;
		console.log("Statistics calculator stopped");
	}
}
