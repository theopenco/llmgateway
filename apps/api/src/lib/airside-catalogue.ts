import { and, cdb, eq, isNull, tables } from "@llmgateway/db";
import { models as staticModels } from "@llmgateway/models";

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

/** True when the static catalogue already maps this model for the provider —
 *  a listing must never shadow (or be overwritten by the worker sync for)
 *  a real catalogue mapping. Deactivated mappings still count here: the sync
 *  keeps owning their DB rows. */
export function staticCatalogueHasMapping(
	providerId: string,
	modelName: string,
): boolean {
	return staticModels.some(
		(m) =>
			(m.id === modelName ||
				("aliases" in m &&
					(m.aliases as readonly string[] | undefined)?.includes(modelName))) &&
			m.providers.some((p) => p.providerId === providerId),
	);
}

/** Like staticCatalogueHasMapping, but ignoring deactivated mappings. This is
 *  the listing/routing rule: deactivating a static mapping hands the model
 *  over to the carrier's Airside listing — the catalogue → DB migration. */
export function staticCatalogueHasActiveMapping(
	providerId: string,
	modelName: string,
): boolean {
	const now = new Date();
	return staticModels.some(
		(m) =>
			(m.id === modelName ||
				("aliases" in m &&
					(m.aliases as readonly string[] | undefined)?.includes(modelName))) &&
			m.providers.some((p) => {
				if (p.providerId !== providerId) {
					return false;
				}
				const deactivatedAt =
					"deactivatedAt" in p
						? (p.deactivatedAt as Date | string | undefined)
						: undefined;
				return !(deactivatedAt && new Date(deactivatedAt) <= now);
			}),
	);
}

export async function materializeAirsideModel(
	model: DraftModelRow,
	filing: FilingPrices,
): Promise<void> {
	if (staticCatalogueHasMapping(model.providerId, model.modelName)) {
		return;
	}
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
			inputPrice: filing.inputPrice,
			outputPrice: filing.outputPrice,
			cachedInputPrice: filing.cachedInputPrice,
			requestPrice: filing.requestPrice,
			contextSize: model.contextSize,
			maxOutput: model.maxOutput,
			streaming: model.streaming,
			vision: model.vision,
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

/** Apply an approved price-update filing to the materialized mapping. */
export async function updateAirsideMappingPrices(
	model: DraftModelRow,
	filing: FilingPrices,
): Promise<void> {
	if (staticCatalogueHasMapping(model.providerId, model.modelName)) {
		return;
	}
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
			),
		);
}

/** Remove the materialized rows when a listing is delisted or revoked. */
export async function dematerializeAirsideModel(
	providerId: string,
	modelName: string,
): Promise<void> {
	if (staticCatalogueHasMapping(providerId, modelName)) {
		return;
	}
	await cdb.transaction(async (tx) => {
		await tx
			.delete(tables.modelProviderMapping)
			.where(
				and(
					eq(tables.modelProviderMapping.modelId, modelName),
					eq(tables.modelProviderMapping.providerId, providerId),
					isNull(tables.modelProviderMapping.region),
				),
			);
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
