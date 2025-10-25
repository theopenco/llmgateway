import {
	db,
	provider,
	model,
	modelProviderMapping,
	log,
	eq,
	and,
	sql,
	isNotNull,
} from "@llmgateway/db";
import { logger } from "@llmgateway/logger";
import { providers, models } from "@llmgateway/models";

export async function syncProvidersAndModels() {
	logger.info("Starting providers and models sync...");

	try {
		const database = db;

		for (const providerDef of providers) {
			await database
				.insert(provider)
				.values({
					id: providerDef.id,
					name: providerDef.name,
					description: providerDef.description,
					streaming: providerDef.streaming,
					cancellation: providerDef.cancellation,
					color: providerDef.color,
					website: providerDef.website,
					announcement: providerDef.announcement,
					status: "active",
				})
				.onConflictDoUpdate({
					target: provider.id,
					set: {
						name: providerDef.name,
						description: providerDef.description,
						streaming: providerDef.streaming,
						cancellation: providerDef.cancellation,
						color: providerDef.color,
						website: providerDef.website,
						announcement: providerDef.announcement,
						updatedAt: new Date(),
					},
				});
		}

		logger.info(`Synced ${providers.length} providers`);

		for (const modelDef of models) {
			await database
				.insert(model)
				.values({
					id: modelDef.id,
					name: modelDef.name || null,
					family: modelDef.family,
					free: "free" in modelDef ? modelDef.free || null : null,
					output: "output" in modelDef ? modelDef.output || null : null,
					status: "active",
				})
				.onConflictDoUpdate({
					target: model.id,
					set: {
						name: modelDef.name || null,
						family: modelDef.family,
						free: "free" in modelDef ? modelDef.free || null : null,
						output: "output" in modelDef ? modelDef.output || null : null,
						updatedAt: new Date(),
					},
				});

			if (modelDef.providers && modelDef.providers.length > 0) {
				for (const mapping of modelDef.providers) {
					const mappings = await database
						.select()
						.from(modelProviderMapping)
						.where(
							and(
								eq(modelProviderMapping.modelId, modelDef.id),
								eq(modelProviderMapping.providerId, mapping.providerId),
							),
						)
						.limit(1);
					const existingMapping = mappings[0];

					if (existingMapping) {
						await database
							.update(modelProviderMapping)
							.set({
								modelName: mapping.modelName,
								inputPrice:
									"inputPrice" in mapping && mapping.inputPrice !== undefined
										? mapping.inputPrice.toString()
										: null,
								outputPrice:
									"outputPrice" in mapping && mapping.outputPrice !== undefined
										? mapping.outputPrice.toString()
										: null,
								cachedInputPrice:
									"cachedInputPrice" in mapping &&
									mapping.cachedInputPrice !== undefined
										? mapping.cachedInputPrice.toString()
										: null,
								imageInputPrice:
									"imageInputPrice" in mapping &&
									mapping.imageInputPrice !== undefined
										? mapping.imageInputPrice.toString()
										: null,
								requestPrice:
									"requestPrice" in mapping &&
									mapping.requestPrice !== undefined
										? mapping.requestPrice.toString()
										: null,
								contextSize:
									"contextSize" in mapping ? mapping.contextSize || null : null,
								maxOutput:
									"maxOutput" in mapping ? mapping.maxOutput || null : null,
								streaming: mapping.streaming === false ? false : true,
								vision: "vision" in mapping ? mapping.vision || null : null,
								reasoning:
									"reasoning" in mapping ? mapping.reasoning || null : null,
								reasoningOutput:
									"reasoningOutput" in mapping
										? (mapping.reasoningOutput as string | null) || null
										: null,
								tools: "tools" in mapping ? mapping.tools || null : null,
								supportedParameters:
									"supportedParameters" in mapping
										? (mapping.supportedParameters as string[] | null) || null
										: null,
								test:
									"test" in mapping
										? (mapping.test as "skip" | "only" | null) || null
										: null,
								status: "active",
								deprecatedAt:
									"deprecatedAt" in mapping
										? mapping.deprecatedAt || null
										: null,
								deactivatedAt:
									"deactivatedAt" in mapping
										? mapping.deactivatedAt || null
										: null,
								updatedAt: new Date(),
							})
							.where(eq(modelProviderMapping.id, existingMapping.id));
					} else {
						await database.insert(modelProviderMapping).values({
							modelId: modelDef.id,
							providerId: mapping.providerId,
							modelName: mapping.modelName,
							inputPrice:
								"inputPrice" in mapping && mapping.inputPrice !== undefined
									? mapping.inputPrice.toString()
									: null,
							outputPrice:
								"outputPrice" in mapping && mapping.outputPrice !== undefined
									? mapping.outputPrice.toString()
									: null,
							cachedInputPrice:
								"cachedInputPrice" in mapping &&
								mapping.cachedInputPrice !== undefined
									? mapping.cachedInputPrice.toString()
									: null,
							imageInputPrice:
								"imageInputPrice" in mapping &&
								mapping.imageInputPrice !== undefined
									? mapping.imageInputPrice.toString()
									: null,
							requestPrice:
								"requestPrice" in mapping && mapping.requestPrice !== undefined
									? mapping.requestPrice.toString()
									: null,
							contextSize:
								"contextSize" in mapping ? mapping.contextSize || null : null,
							maxOutput:
								"maxOutput" in mapping ? mapping.maxOutput || null : null,
							streaming: mapping.streaming === false ? false : true,
							vision: "vision" in mapping ? mapping.vision || null : null,
							reasoning:
								"reasoning" in mapping ? mapping.reasoning || null : null,
							reasoningOutput:
								"reasoningOutput" in mapping
									? (mapping.reasoningOutput as string | null) || null
									: null,
							tools: "tools" in mapping ? mapping.tools || null : null,
							supportedParameters:
								"supportedParameters" in mapping
									? (mapping.supportedParameters as string[] | null) || null
									: null,
							deprecatedAt:
								"deprecatedAt" in mapping ? mapping.deprecatedAt || null : null,
							deactivatedAt:
								"deactivatedAt" in mapping
									? mapping.deactivatedAt || null
									: null,
							test:
								"test" in mapping
									? (mapping.test as "skip" | "only" | null) || null
									: null,
							status: "active",
						});
					}
				}
			}
		}

		logger.info(`Synced ${models.length} models`);

		const mappingCount = await database.select().from(modelProviderMapping);
		logger.info(`Total model-provider mappings: ${mappingCount.length}`);

		logger.info("Providers and models sync completed successfully");
	} catch (error) {
		logger.error("Error syncing providers and models:", error as Error);
		throw error;
	}
}

export async function updateTimingAverages() {
	logger.info("Starting timing averages update...");

	try {
		const database = db;

		// Update provider averages
		const providerAverages = await database
			.select({
				providerId: log.usedProvider,
				avgTimeToFirstToken: sql<number>`avg(${log.timeToFirstToken})`.as(
					"avgTimeToFirstToken",
				),
				avgTimeToFirstReasoningToken:
					sql<number>`avg(${log.timeToFirstReasoningToken})`.as(
						"avgTimeToFirstReasoningToken",
					),
			})
			.from(log)
			.where(and(isNotNull(log.timeToFirstToken), eq(log.streamed, true)))
			.groupBy(log.usedProvider);

		for (const avg of providerAverages) {
			await database
				.update(provider)
				.set({
					avgTimeToFirstToken: avg.avgTimeToFirstToken,
					avgTimeToFirstReasoningToken: avg.avgTimeToFirstReasoningToken,
					statsUpdatedAt: new Date(),
				})
				.where(eq(provider.id, avg.providerId));
		}

		// Update model averages
		const modelAverages = await database
			.select({
				modelId: sql<string>`split_part(${log.usedModel}, '/', 2)`.as(
					"modelId",
				),
				avgTimeToFirstToken: sql<number>`avg(${log.timeToFirstToken})`.as(
					"avgTimeToFirstToken",
				),
				avgTimeToFirstReasoningToken:
					sql<number>`avg(${log.timeToFirstReasoningToken})`.as(
						"avgTimeToFirstReasoningToken",
					),
			})
			.from(log)
			.where(and(isNotNull(log.timeToFirstToken), eq(log.streamed, true)))
			.groupBy(sql`split_part(${log.usedModel}, '/', 2)`);

		for (const avg of modelAverages) {
			await database
				.update(model)
				.set({
					avgTimeToFirstToken: avg.avgTimeToFirstToken,
					avgTimeToFirstReasoningToken: avg.avgTimeToFirstReasoningToken,
					statsUpdatedAt: new Date(),
				})
				.where(eq(model.id, avg.modelId));
		}

		// Update model-provider mapping averages
		const mappingAverages = await database
			.select({
				modelId: sql<string>`split_part(${log.usedModel}, '/', 2)`.as(
					"modelId",
				),
				providerId: log.usedProvider,
				avgTimeToFirstToken: sql<number>`avg(${log.timeToFirstToken})`.as(
					"avgTimeToFirstToken",
				),
				avgTimeToFirstReasoningToken:
					sql<number>`avg(${log.timeToFirstReasoningToken})`.as(
						"avgTimeToFirstReasoningToken",
					),
			})
			.from(log)
			.where(and(isNotNull(log.timeToFirstToken), eq(log.streamed, true)))
			.groupBy(sql`split_part(${log.usedModel}, '/', 2)`, log.usedProvider);

		for (const avg of mappingAverages) {
			await database
				.update(modelProviderMapping)
				.set({
					avgTimeToFirstToken: avg.avgTimeToFirstToken,
					avgTimeToFirstReasoningToken: avg.avgTimeToFirstReasoningToken,
					statsUpdatedAt: new Date(),
				})
				.where(
					and(
						eq(modelProviderMapping.modelId, avg.modelId),
						eq(modelProviderMapping.providerId, avg.providerId),
					),
				);
		}

		logger.info("Timing averages update completed successfully");
	} catch (error) {
		logger.error("Error updating timing averages:", error as Error);
		throw error;
	}
}
