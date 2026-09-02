import { and, cdb, eq, isNull, tables } from "@llmgateway/db";
import {
	expandAllProviderRegions,
	models as catalogueModels,
	staticCatalogueMapsModel,
} from "@llmgateway/models";

import type { ProviderModelMapping } from "@llmgateway/models";

type DraftModelRow = typeof tables.providerDraftModel.$inferSelect;

interface FilingPrices {
	inputPrice: string;
	outputPrice: string;
	cachedInputPrice: string | null;
	requestPrice: string | null;
}

/**
 * Materialization of approved Airside listings into the DB catalogue tables
 * (`model` + `model_provider_mapping`). Those tables back /internal/models
 * and /internal/providers, which feed the public models directory and the
 * playground selector — so an approved listing shows up everywhere the
 * synced catalogue does. The worker's sync only upserts rows for the static
 * catalogue and never reconciles, so airside rows (marked family "airside")
 * are safe from being swept.
 */

/** Active static mappings must be imported before a carrier can manage them. */
export function staticCatalogueHasActiveMapping(
	providerId: string,
	modelName: string,
): boolean {
	return staticCatalogueMapsModel(providerId, modelName, { activeOnly: true });
}

export async function materializeAirsideModel(
	model: DraftModelRow,
	filing: FilingPrices,
): Promise<void> {
	await cdb.transaction(async (tx) => {
		// The worker sync normally creates provider rows at boot; make the
		// materialization self-sufficient for fresh installs and tests.
		await tx
			.insert(tables.provider)
			.values({
				id: model.providerId,
				name: model.providerId,
				description: "",
			})
			.onConflictDoNothing();
		const existingModel = await tx
			.select({ id: tables.model.id })
			.from(tables.model)
			.where(eq(tables.model.id, model.modelName))
			.limit(1);
		if (existingModel.length === 0) {
			await tx.insert(tables.model).values({
				id: model.modelName,
				family: "airside",
				name: model.displayName ?? model.modelName,
				description: model.description ?? undefined,
				status: "active",
			});
		}
		const mappingValues = {
			externalId: model.modelName,
			source: "airside" as const,
			inputPrice: filing.inputPrice,
			outputPrice: filing.outputPrice,
			cachedInputPrice: filing.cachedInputPrice,
			requestPrice: filing.requestPrice,
			contextSize: model.contextSize,
			maxOutput: model.maxOutput,
			streaming: model.streaming,
			vision: model.vision,
			audio: model.audio,
			tools: model.tools,
			jsonOutput: model.jsonOutput,
			reasoning: model.reasoning,
			reasoningEfforts: model.reasoningEfforts,
			status: "active" as const,
			deactivatedAt: null,
		};
		const existingMapping = await tx
			.select({ id: tables.modelProviderMapping.id })
			.from(tables.modelProviderMapping)
			.where(
				and(
					eq(tables.modelProviderMapping.modelId, model.modelName),
					eq(tables.modelProviderMapping.providerId, model.providerId),
					isNull(tables.modelProviderMapping.region),
				),
			)
			.limit(1);
		if (existingMapping.length > 0) {
			await tx
				.update(tables.modelProviderMapping)
				.set(mappingValues)
				.where(eq(tables.modelProviderMapping.id, existingMapping[0].id));
		} else {
			await tx.insert(tables.modelProviderMapping).values({
				modelId: model.modelName,
				providerId: model.providerId,
				...mappingValues,
			});
		}
	});
}

/**
 * Non-pricing edits to an ACTIVE listing apply to the materialized catalogue
 * rows immediately — capabilities, context, reasoning efforts and display
 * metadata are carrier-editable, only pricing waits for an approved filing.
 */
export async function syncAirsideModelMetadata(
	model: DraftModelRow,
): Promise<void> {
	if (model.status !== "active") {
		return;
	}
	await cdb.transaction(async (tx) => {
		await tx
			.update(tables.model)
			.set({
				name: model.displayName ?? model.modelName,
				description: model.description ?? "",
			})
			.where(
				and(
					eq(tables.model.id, model.modelName),
					eq(tables.model.family, "airside"),
				),
			);
		await tx
			.update(tables.modelProviderMapping)
			.set({
				contextSize: model.contextSize,
				maxOutput: model.maxOutput,
				streaming: model.streaming,
				vision: model.vision,
				audio: model.audio,
				tools: model.tools,
				jsonOutput: model.jsonOutput,
				reasoning: model.reasoning,
				reasoningEfforts: model.reasoningEfforts,
			})
			.where(
				and(
					eq(tables.modelProviderMapping.modelId, model.modelName),
					eq(tables.modelProviderMapping.providerId, model.providerId),
					isNull(tables.modelProviderMapping.region),
					eq(tables.modelProviderMapping.source, "airside"),
				),
			);
	});
}

/** Apply an approved price-update filing to the materialized mapping. */
export async function updateAirsideMappingPrices(
	model: DraftModelRow,
	filing: FilingPrices,
): Promise<void> {
	await cdb
		.update(tables.modelProviderMapping)
		.set({
			inputPrice: filing.inputPrice,
			outputPrice: filing.outputPrice,
			cachedInputPrice: filing.cachedInputPrice,
			requestPrice: filing.requestPrice,
		})
		.where(
			and(
				eq(tables.modelProviderMapping.modelId, model.modelName),
				eq(tables.modelProviderMapping.providerId, model.providerId),
				isNull(tables.modelProviderMapping.region),
				eq(tables.modelProviderMapping.source, "airside"),
			),
		);
}

function findStaticMapping(providerId: string, modelName: string) {
	const definition = catalogueModels.find(
		(model) =>
			model.id === modelName ||
			("aliases" in model &&
				(model.aliases as readonly string[] | undefined)?.includes(modelName)),
	);
	if (!definition) {
		return null;
	}
	const mapping = expandAllProviderRegions(definition.providers).find(
		(candidate) =>
			candidate.providerId === providerId && candidate.region === undefined,
	) as ProviderModelMapping | undefined;
	return mapping ? { definition, mapping } : null;
}

function staticMappingValues(mapping: ProviderModelMapping) {
	return {
		externalId: mapping.externalId,
		source: "catalogue" as const,
		inputPrice: mapping.inputPrice?.toString() ?? null,
		outputPrice: mapping.outputPrice?.toString() ?? null,
		cachedInputPrice: mapping.cachedInputPrice?.toString() ?? null,
		cacheWriteInputPrice: mapping.cacheWriteInputPrice?.toString() ?? null,
		cacheWriteInputPrice1h: mapping.cacheWriteInputPrice1h?.toString() ?? null,
		imageInputPrice: mapping.imageInputPrice?.toString() ?? null,
		requestPrice: mapping.requestPrice?.toString() ?? null,
		contextSize: mapping.contextSize ?? null,
		maxOutput: mapping.maxOutput ?? null,
		streaming: mapping.streaming !== false,
		vision: mapping.vision ?? null,
		audio: mapping.audio ?? null,
		reasoning: mapping.reasoning ?? null,
		reasoningMaxTokens: mapping.reasoningMaxTokens ?? false,
		reasoningOutput: mapping.reasoningOutput ?? null,
		reasoningEfforts: null,
		tools: mapping.tools ?? null,
		jsonOutput: mapping.jsonOutput ?? false,
		jsonOutputSchema: mapping.jsonOutputSchema ?? false,
		webSearch: mapping.webSearch ?? false,
		webSearchPrice: mapping.webSearchPrice?.toString() ?? null,
		stability: mapping.stability ?? "stable",
		supportedParameters:
			(mapping.supportedParameters as string[] | undefined) ?? null,
		test: mapping.test ?? null,
		deprecatedAt: mapping.deprecatedAt ?? null,
		deactivatedAt: mapping.deactivatedAt ?? null,
		status: "active" as const,
	};
}

/** Restore the static mapping, or remove a DB-only mapping, on delist. */
export async function dematerializeAirsideModel(
	providerId: string,
	modelName: string,
): Promise<void> {
	const staticEntry = findStaticMapping(providerId, modelName);
	await cdb.transaction(async (tx) => {
		const mappingWhere = and(
			eq(tables.modelProviderMapping.modelId, modelName),
			eq(tables.modelProviderMapping.providerId, providerId),
			isNull(tables.modelProviderMapping.region),
			eq(tables.modelProviderMapping.source, "airside"),
		);
		if (staticEntry) {
			await tx
				.update(tables.modelProviderMapping)
				.set(staticMappingValues(staticEntry.mapping))
				.where(mappingWhere);
		} else {
			await tx.delete(tables.modelProviderMapping).where(mappingWhere);
		}
		// Drop the model row only when it was ours and nothing else maps it.
		const modelRow = await tx
			.select({ id: tables.model.id, family: tables.model.family })
			.from(tables.model)
			.where(eq(tables.model.id, modelName))
			.limit(1);
		if (modelRow.length === 0 || modelRow[0].family !== "airside") {
			return;
		}
		const remaining = await tx
			.select({ id: tables.modelProviderMapping.id })
			.from(tables.modelProviderMapping)
			.where(eq(tables.modelProviderMapping.modelId, modelName))
			.limit(1);
		if (remaining.length === 0) {
			await tx.delete(tables.model).where(eq(tables.model.id, modelName));
		}
	});
}
