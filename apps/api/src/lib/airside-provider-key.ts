import { buildVerificationTarget } from "@/lib/model-verification.js";

import { runProviderKeySmokeTest } from "@llmgateway/actions";
import { db } from "@llmgateway/db";
import {
	models,
	providers,
	type ProviderValidationResult,
} from "@llmgateway/models";

/** DB-only mappings have no static validation model. */
export async function validateAirsideKey(
	provider: string,
	token: string,
	baseUrl?: string,
	allowedModels?: string[] | null,
): Promise<ProviderValidationResult | undefined> {
	if (
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
	const isCatalogueProvider = providers.some((entry) => entry.id === provider);
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
		skipEnvVars: !isCatalogueProvider,
	});
	return {
		valid: !failure,
		model: mapping.modelId,
		error: failure ?? undefined,
	};
}
