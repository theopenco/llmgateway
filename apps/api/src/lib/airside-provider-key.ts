import { buildVerificationTarget } from "@/lib/model-verification.js";

import { runProviderKeySmokeTest } from "@llmgateway/actions";
import { db } from "@llmgateway/db";
import {
	models,
	providers,
	type ProviderValidationResult,
} from "@llmgateway/models";

import type { ProviderKeyOptions } from "@llmgateway/db";

/**
 * Model ids each provider serves through a live Airside listing. These live
 * only in the DB catalogue, so the static `@llmgateway/models` lookups never
 * see them.
 */
export async function listAirsideModelIds(
	providerIds: readonly string[],
	now: Date = new Date(),
): Promise<Map<string, string[]>> {
	const byProvider = new Map<string, string[]>();
	if (providerIds.length === 0) {
		return byProvider;
	}
	const listings = await db.query.modelProviderMapping.findMany({
		where: {
			providerId: { in: [...providerIds] },
			source: "airside",
			status: "active",
			region: { isNull: true },
		},
		columns: { providerId: true, modelId: true, deactivatedAt: true },
	});
	for (const listing of listings) {
		if (listing.deactivatedAt && listing.deactivatedAt <= now) {
			continue;
		}
		const ids = byProvider.get(listing.providerId) ?? [];
		if (!ids.includes(listing.modelId)) {
			ids.push(listing.modelId);
		}
		byProvider.set(listing.providerId, ids);
	}
	return byProvider;
}

/** DB-only mappings have no static validation model. */
export async function validateAirsideKey(
	provider: string,
	token: string,
	baseUrl?: string,
	allowedModels?: string[] | null,
	providerKeyOptions?: ProviderKeyOptions,
): Promise<ProviderValidationResult | undefined> {
	const isCatalogueProvider = providers.some((entry) => entry.id === provider);
	if (
		isCatalogueProvider &&
		models.some(
			(model) =>
				(!allowedModels?.length || allowedModels.includes(model.id)) &&
				model.providers.some((mapping) => mapping.providerId === provider),
		)
	) {
		return undefined;
	}
	const [claim, mappings] = await Promise.all([
		db.query.providerClaim.findFirst({
			where: { providerId: provider, status: "active" },
		}),
		db.query.modelProviderMapping.findMany({
			where: { providerId: provider, source: "airside", status: "active" },
		}),
	]);
	const mapping = mappings.find(
		(row) =>
			(!allowedModels?.length || allowedModels.includes(row.modelId)) &&
			(!row.deactivatedAt || row.deactivatedAt > new Date()),
	);
	const carrierBaseUrl = isCatalogueProvider ? undefined : claim?.customBaseUrl;
	if (!mapping || (!isCatalogueProvider && !carrierBaseUrl)) {
		return undefined;
	}
	const target = buildVerificationTarget({
		...mapping,
		modelName: mapping.modelId,
	});
	const failure = await runProviderKeySmokeTest({
		target,
		token,
		baseUrl: baseUrl ?? carrierBaseUrl ?? undefined,
		providerKeyOptions,
		skipEnvVars: !isCatalogueProvider,
	});
	return {
		valid: !failure,
		model: mapping.modelId,
		error: failure ?? undefined,
	};
}
