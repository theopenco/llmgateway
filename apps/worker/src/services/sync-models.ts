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
					name: modelDef.name,
					aliases: "aliases" in modelDef ? modelDef.aliases : undefined,
					description:
						"description" in modelDef ? modelDef.description : undefined,
					family: modelDef.family,
					free: "free" in modelDef ? modelDef.free : undefined,
					output: "output" in modelDef ? modelDef.output : undefined,
					stability: "stability" in modelDef ? modelDef.stability : undefined,
					releasedAt:
						"releasedAt" in modelDef ? modelDef.releasedAt : undefined,
					status: "active",
				})
				.onConflictDoUpdate({
					target: model.id,
					// Use explicit defaults for notNull fields when not defined
					set: {
						name: modelDef.name,
						aliases: "aliases" in modelDef ? modelDef.aliases : [],
						description:
							"description" in modelDef ? modelDef.description : "(empty)",
						family: modelDef.family,
						free: "free" in modelDef ? modelDef.free : false,
						output: "output" in modelDef ? modelDef.output : ["text"],
						stability: "stability" in modelDef ? modelDef.stability : "stable",
						releasedAt:
							"releasedAt" in modelDef ? modelDef.releasedAt : new Date(),
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
						// Use null (not undefined) for missing fields to ensure DB is updated
						// undefined in Drizzle means "don't update", null means "set to NULL"
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
									"contextSize" in mapping ? mapping.contextSize : null,
								maxOutput: "maxOutput" in mapping ? mapping.maxOutput : null,
								streaming: mapping.streaming === false ? false : true,
								vision: "vision" in mapping ? mapping.vision : null,
								reasoning: "reasoning" in mapping ? mapping.reasoning : null,
								reasoningMaxTokens:
									"reasoningMaxTokens" in mapping
										? (mapping.reasoningMaxTokens ?? false)
										: false,
								reasoningOutput:
									"reasoningOutput" in mapping
										? (mapping.reasoningOutput as string | null)
										: null,
								tools: "tools" in mapping ? mapping.tools : null,
								// NotNull boolean fields - use explicit defaults when not defined
								jsonOutput:
									"jsonOutput" in mapping ? mapping.jsonOutput : false,
								jsonOutputSchema:
									"jsonOutputSchema" in mapping
										? mapping.jsonOutputSchema
										: false,
								webSearch: "webSearch" in mapping ? mapping.webSearch : false,
								webSearchPrice:
									"webSearchPrice" in mapping &&
									mapping.webSearchPrice !== undefined
										? mapping.webSearchPrice.toString()
										: null,
								// NotNull decimal field - use explicit default
								discount:
									"discount" in mapping && mapping.discount !== undefined
										? mapping.discount.toString()
										: "0",
								// NotNull enum field - use explicit default
								stability:
									"stability" in mapping ? mapping.stability : "stable",
								supportedParameters:
									"supportedParameters" in mapping
										? (mapping.supportedParameters as string[] | null)
										: null,
								test:
									"test" in mapping
										? (mapping.test as "skip" | "only" | null)
										: null,
								status: "active",
								deprecatedAt:
									"deprecatedAt" in mapping
										? (mapping.deprecatedAt ?? null)
										: null,
								deactivatedAt:
									"deactivatedAt" in mapping
										? (mapping.deactivatedAt ?? null)
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
									: undefined,
							outputPrice:
								"outputPrice" in mapping && mapping.outputPrice !== undefined
									? mapping.outputPrice.toString()
									: undefined,
							cachedInputPrice:
								"cachedInputPrice" in mapping &&
								mapping.cachedInputPrice !== undefined
									? mapping.cachedInputPrice.toString()
									: undefined,
							imageInputPrice:
								"imageInputPrice" in mapping &&
								mapping.imageInputPrice !== undefined
									? mapping.imageInputPrice.toString()
									: undefined,
							requestPrice:
								"requestPrice" in mapping && mapping.requestPrice !== undefined
									? mapping.requestPrice.toString()
									: undefined,
							contextSize:
								"contextSize" in mapping ? mapping.contextSize : undefined,
							maxOutput: "maxOutput" in mapping ? mapping.maxOutput : undefined,
							streaming: mapping.streaming === false ? false : true,
							vision: "vision" in mapping ? mapping.vision : undefined,
							reasoning: "reasoning" in mapping ? mapping.reasoning : undefined,
							reasoningMaxTokens:
								"reasoningMaxTokens" in mapping
									? (mapping.reasoningMaxTokens ?? false)
									: false,
							reasoningOutput:
								"reasoningOutput" in mapping
									? (mapping.reasoningOutput as string | undefined)
									: undefined,
							tools: "tools" in mapping ? mapping.tools : undefined,
							jsonOutput:
								"jsonOutput" in mapping ? mapping.jsonOutput : undefined,
							jsonOutputSchema:
								"jsonOutputSchema" in mapping
									? mapping.jsonOutputSchema
									: undefined,
							webSearch: "webSearch" in mapping ? mapping.webSearch : undefined,
							webSearchPrice:
								"webSearchPrice" in mapping &&
								mapping.webSearchPrice !== undefined
									? mapping.webSearchPrice.toString()
									: undefined,
							discount:
								"discount" in mapping && mapping.discount !== undefined
									? mapping.discount.toString()
									: undefined,
							stability: "stability" in mapping ? mapping.stability : undefined,
							supportedParameters:
								"supportedParameters" in mapping
									? (mapping.supportedParameters as string[] | undefined)
									: undefined,
							deprecatedAt:
								"deprecatedAt" in mapping ? mapping.deprecatedAt : undefined,
							deactivatedAt:
								"deactivatedAt" in mapping ? mapping.deactivatedAt : undefined,
							test:
								"test" in mapping
									? (mapping.test as "skip" | "only" | undefined)
									: undefined,
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
