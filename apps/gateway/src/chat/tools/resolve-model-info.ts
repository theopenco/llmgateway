import { HTTPException } from "hono/http-exception";

import {
	type Model,
	type ModelDefinition,
	models,
	type Provider,
	type ProviderModelMapping,
} from "@llmgateway/models";

export interface ResolveModelInfoResult {
	modelInfo: ModelDefinition;
	activeProviders: ProviderModelMapping[];
	allModelProviders: ProviderModelMapping[];
	requestedProvider: Provider | undefined;
}

/** 410 for a provider pin whose mapping for the model is deactivated. */
export function deactivatedProviderPinError(
	provider: string,
	modelId: string,
): HTTPException {
	return new HTTPException(410, {
		message: `Provider ${provider} no longer serves model ${modelId}: the mapping has been deactivated. Request "${modelId}" without a provider prefix to route to an active provider.`,
	});
}

/**
 * Resolves full model info and filters deactivated providers.
 *
 * For custom providers, creates a mock model info that treats it as an OpenAI-compatible model.
 * For regular providers, looks up model info from the models list and filters out deactivated providers.
 *
 * @throws HTTPException if the model is not supported, all providers are
 * deactivated, or the requested provider's mapping is deactivated
 */
export function resolveModelInfo(
	requestedModel: Model,
	requestedProvider: Provider | undefined,
): ResolveModelInfoResult {
	let modelInfo: ModelDefinition;

	if (requestedProvider === "custom") {
		// For custom providers, we create a mock model info that treats it as an OpenAI-compatible model
		modelInfo = {
			id: requestedModel as string,
			family: "custom",
			providers: [
				{
					providerId: "custom" as const,
					externalId: requestedModel,
					inputPrice: "0",
					outputPrice: "0",
					// Custom providers have no catalog entry, so the gateway cannot
					// know their limits (contextSize, maxOutput) or capabilities
					// (vision, jsonOutput, ...). Leave them unset rather than
					// guessing — capability validation is skipped for custom
					// providers and the upstream provider enforces its own limits.
					// Unknown custom models stay permissive; catalog-backed requests
					// replace this with their configured streaming capability.
					streaming: true,
				},
			],
		};
	} else {
		// Strip only the trailing :region suffix for model lookup
		// (e.g., "deepseek-v3.2:cn-beijing" → "deepseek-v3.2"). Use lastIndexOf
		// because some upstream model names already contain a colon
		// (e.g., "anthropic.claude-haiku-4-5-20251001-v1:0").
		const lastColonIdx = requestedModel.lastIndexOf(":");
		const baseRequestedModel =
			lastColonIdx > -1
				? requestedModel.slice(0, lastColonIdx)
				: requestedModel;

		// Resolve strictly by catalog id. externalId is the upstream provider's
		// model name and must never be used to identify a catalog entry — two
		// entries (e.g. a free and a paid sibling) can share the same externalId.
		// When a specific provider is requested, prefer the definition that includes that provider
		let foundModel = requestedProvider
			? models.find(
					(m) =>
						m.id === baseRequestedModel &&
						m.providers.some((p) => p.providerId === requestedProvider),
				)
			: undefined;
		foundModel ??= models.find((m) => m.id === baseRequestedModel);

		if (!foundModel) {
			throw new HTTPException(400, {
				message: `Unsupported model: ${requestedModel}`,
			});
		}

		modelInfo = foundModel;
	}

	// Save original providers list (including deactivated) for routing metadata display
	const allModelProviders = modelInfo.providers;

	// Filter out deactivated provider mappings
	const now = new Date();
	const activeProviders = modelInfo.providers.filter(
		(provider) =>
			!(
				(provider as ProviderModelMapping).deactivatedAt &&
				now > (provider as ProviderModelMapping).deactivatedAt!
			),
	);

	// Check if all providers are deactivated
	if (activeProviders.length === 0) {
		throw new HTTPException(410, {
			message: `Model ${requestedModel} has been deactivated and is no longer available`,
		});
	}

	// Update modelInfo to only include active providers
	modelInfo = {
		...modelInfo,
		providers: activeProviders,
	};

	// A pin is never rerouted: a deactivated pinned mapping is an error, like a
	// deactivated model or region pin.
	if (
		requestedProvider &&
		requestedProvider !== "llmgateway" &&
		requestedProvider !== "custom" &&
		!activeProviders.some((p) => p.providerId === requestedProvider)
	) {
		throw deactivatedProviderPinError(requestedProvider, modelInfo.id);
	}

	return {
		modelInfo,
		activeProviders,
		allModelProviders,
		requestedProvider,
	};
}
