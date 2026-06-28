import { HTTPException } from "hono/http-exception";

import {
	type Model,
	models,
	type Provider,
	providers,
} from "@llmgateway/models";

export interface ParseModelInputResult {
	requestedModel: Model;
	requestedProvider: Provider | undefined;
	customProviderName: string | undefined;
	requestedRegion: string | undefined;
}

/**
 * Parses a model input string to resolve the model, provider, and custom provider name.
 *
 * Handles various input formats:
 * - "auto" or "custom" -> llmgateway provider
 * - "provider/model" -> specific provider and model
 * - "provider/model:region" -> specific provider, model, and region
 * - "customProvider/model" -> custom provider with any model name
 * - "model-id" -> model ID lookup
 *
 * @throws HTTPException if the model or provider is not supported
 */
export function parseModelInput(modelInput: string): ParseModelInputResult {
	let requestedModel: Model = modelInput as Model;
	let requestedProvider: Provider | undefined;
	let customProviderName: string | undefined;
	let requestedRegion: string | undefined;

	// check if there is an exact model match
	if (modelInput === "auto" || modelInput === "custom") {
		requestedProvider = "llmgateway";
		requestedModel = modelInput as Model;
	} else if (modelInput.includes("/")) {
		const split = modelInput.split("/");
		const providerCandidate = split[0];

		// Check if the provider exists
		const knownProvider = providers.find((p) => p.id === providerCandidate);
		if (!knownProvider) {
			// This might be a custom provider name - we'll validate against the database later
			// For now, assume it's a potential custom provider
			customProviderName = providerCandidate;
			requestedProvider = "custom";
		} else {
			requestedProvider = providerCandidate as Provider;
		}
		// Handle model names with multiple slashes (e.g. together.ai/meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo)
		let modelName = split.slice(1).join("/");

		// Parse optional region suffix (e.g. "qwen-plus:cn-beijing")
		if (modelName.includes(":")) {
			const colonIdx = modelName.lastIndexOf(":");
			requestedRegion = modelName.slice(colonIdx + 1);
			modelName = modelName.slice(0, colonIdx);
		}

		// For custom providers, we don't need to validate the model name
		// since they can use any OpenAI-compatible model name
		if (requestedProvider === "custom") {
			requestedModel = modelName as Model;
		} else {
			// First try to find by base model name with matching provider
			let modelDef = models.find(
				(m) =>
					m.id === modelName &&
					m.providers.some((p) => p.providerId === requestedProvider),
			);

			// Fall back to matching by catalog id only
			modelDef ??= models.find((m) => m.id === modelName);

			if (!modelDef) {
				throw new HTTPException(400, {
					message: `Requested model ${modelName} not supported`,
				});
			}

			if (!modelDef.providers.some((p) => p.providerId === requestedProvider)) {
				throw new HTTPException(400, {
					message: `Provider ${requestedProvider} does not support model ${modelName}`,
				});
			}

			// Use the canonical catalog id, never the upstream externalId: two
			// catalog entries (e.g. a free and a paid sibling) can share the same
			// externalId, so collapsing to externalId here would let downstream
			// resolution pick the wrong entry. The upstream externalId is derived
			// separately from the selected provider mapping at request time.
			requestedModel = modelDef.id as Model;
		}
	} else if (models.find((m) => m.id === modelInput)) {
		requestedModel = modelInput as Model;
	} else {
		throw new HTTPException(400, {
			message: `Requested model ${modelInput} not supported`,
		});
	}

	if (
		requestedProvider &&
		requestedProvider !== "custom" &&
		!providers.find((p) => p.id === requestedProvider)
	) {
		throw new HTTPException(400, {
			message: `Requested provider ${requestedProvider} not supported`,
		});
	}

	return {
		requestedModel,
		requestedProvider,
		customProviderName,
		requestedRegion,
	};
}
