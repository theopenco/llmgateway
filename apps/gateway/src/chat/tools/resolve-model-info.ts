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
	/** Updated requestedProvider - may be cleared if original was deactivated */
	requestedProvider: Provider | undefined;
}

/**
 * Resolves full model info and filters deactivated providers.
 *
 * For custom providers, creates a mock model info that treats it as an OpenAI-compatible model.
 * For regular providers, looks up model info from the models list and filters out deactivated providers.
 *
 * @throws HTTPException if the model is not supported or all providers are deactivated
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
					modelName: requestedModel,
					inputPrice: 0,
					outputPrice: 0,
					contextSize: 8192,
					maxOutput: 4096,
					streaming: true,
					vision: false,
					jsonOutput: true,
				},
			],
		};
	} else {
		// First try to find by model ID
		let foundModel = models.find((m) => m.id === requestedModel);

		// If not found, search by provider model name
		// If a specific provider is requested, match both modelName and providerId
		if (!foundModel) {
			if (requestedProvider) {
				foundModel = models.find((m) =>
					m.providers.find(
						(p) =>
							p.modelName === requestedModel &&
							p.providerId === requestedProvider,
					),
				);
			} else {
				foundModel = models.find((m) =>
					m.providers.find((p) => p.modelName === requestedModel),
				);
			}
		}

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

	// If a specific provider was requested but is now deactivated, clear it
	// so routing logic will pick another active provider
	let updatedRequestedProvider = requestedProvider;
	if (
		requestedProvider &&
		requestedProvider !== "llmgateway" &&
		requestedProvider !== "custom" &&
		!activeProviders.some((p) => p.providerId === requestedProvider)
	) {
		// The requested provider was deactivated, routing will select another
		updatedRequestedProvider = undefined;
	}

	return {
		modelInfo,
		activeProviders,
		allModelProviders,
		requestedProvider: updatedRequestedProvider,
	};
}
