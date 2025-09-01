import {
	db,
	provider,
	model,
	modelProviderMapping,
	eq,
	and,
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
					jsonOutput:
						"jsonOutput" in providerDef ? providerDef.jsonOutput || null : null,
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
						jsonOutput:
							"jsonOutput" in providerDef
								? providerDef.jsonOutput || null
								: null,
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
					jsonOutput:
						"jsonOutput" in modelDef ? modelDef.jsonOutput || null : null,
					free: "free" in modelDef ? modelDef.free || null : null,
					deprecatedAt: modelDef.deprecatedAt || null,
					deactivatedAt: modelDef.deactivatedAt || null,
					output: "output" in modelDef ? modelDef.output || null : null,
					status: "active",
				})
				.onConflictDoUpdate({
					target: model.id,
					set: {
						name: modelDef.name || null,
						family: modelDef.family,
						jsonOutput:
							"jsonOutput" in modelDef ? modelDef.jsonOutput || null : null,
						free: "free" in modelDef ? modelDef.free || null : null,
						deprecatedAt: modelDef.deprecatedAt || null,
						deactivatedAt: modelDef.deactivatedAt || null,
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
