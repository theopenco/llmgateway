import { logger } from "@llmgateway/logger";

import { getCheapestModelForProvider } from "./get-cheapest-model-for-provider.js";
import { getProviderEndpoint } from "./get-provider-endpoint.js";
import { getProviderHeaders } from "./get-provider-headers.js";
import { models, type ProviderModelMapping } from "./models.js";
import { prepareRequestBody } from "./prepare-request-body.js";

import type { ProviderId } from "./providers.js";
import type { BaseMessage, ProviderValidationResult } from "./types.js";

/**
 * Validate a provider API key by making a minimal request
 */
export async function validateProviderKey(
	provider: ProviderId,
	token: string,
	baseUrl?: string,
	skipValidation = false,
): Promise<ProviderValidationResult> {
	// Skip validation if requested (e.g. in test environment)
	if (skipValidation) {
		return { valid: true };
	}

	// Skip validation for custom providers since they don't have predefined models
	if (provider === "custom") {
		return { valid: true };
	}

	try {
		// Determine the validation model first (needed for endpoint URL)
		const validationModel = getCheapestModelForProvider(provider);

		logger.debug("Using validation model", {
			provider,
			validationModel: validationModel || undefined,
		});
		if (!validationModel) {
			throw new Error(
				`No model with pricing information found for provider ${provider}`,
			);
		}

		// Find the model definition to get the model ID
		const modelDef = models.find((m) =>
			m.providers.some(
				(p) => p.providerId === provider && p.modelName === validationModel,
			),
		);
		const modelId = modelDef?.id;

		const endpoint = getProviderEndpoint(
			provider,
			baseUrl,
			modelId, // Pass model ID for providers that need it in the URL (e.g., aws-bedrock)
			provider === "google-ai-studio" ? token : undefined,
			false, // validation doesn't need streaming
			false, // supportsReasoning - disable for validation
			false, // hasExistingToolCalls - disable for validation
		);

		// Use prepareRequestBody to create the validation payload
		const systemMessage: BaseMessage = {
			role: "system",
			content: "You are a helpful assistant.",
		};
		const minimalMessage: BaseMessage = {
			role: "user",
			content: "Hello",
		};
		const messages: BaseMessage[] = [systemMessage, minimalMessage];

		// Check if max_tokens is supported
		const providerMapping = modelDef?.providers.find(
			(p) => p.providerId === provider && p.modelName === validationModel,
		);
		const supportedParameters = (
			providerMapping as ProviderModelMapping | undefined
		)?.supportedParameters;
		const supportsMaxTokens =
			supportedParameters?.includes("max_tokens") ?? true;

		const payload = await prepareRequestBody(
			provider,
			validationModel,
			messages,
			false, // stream
			undefined, // temperature
			supportsMaxTokens ? 1 : undefined, // max_tokens - minimal for validation, undefined if not supported
			undefined, // top_p
			undefined, // frequency_penalty
			undefined, // presence_penalty
			undefined, // response_format
			undefined, // tools
			undefined, // tool_choice
			undefined, // reasoning_effort
			false, // supportsReasoning - disable for validation
			false, // isProd - allow http URLs for validation/testing
		);

		const headers = getProviderHeaders(provider, token);
		headers["Content-Type"] = "application/json";

		const response = await fetch(endpoint, {
			method: "POST",
			headers,
			body: JSON.stringify(payload),
		});

		if (!response.ok) {
			const errorText = await response.text();
			let errorMessage = `Error from provider: ${response.status} ${response.statusText}`;

			try {
				const errorJson = JSON.parse(errorText);
				if (errorJson.error?.message) {
					errorMessage = errorJson.error.message;
				} else if (errorJson.message) {
					errorMessage = errorJson.message;
				}
			} catch {}

			if (response.status === 401) {
				return {
					valid: false,
					statusCode: response.status,
					model: validationModel,
				};
			}

			return {
				valid: false,
				error: errorMessage,
				statusCode: response.status,
				model: validationModel,
			};
		}

		return { valid: true, model: validationModel };
	} catch (error) {
		return {
			valid: false,
			error: error instanceof Error ? error.message : "Unknown error occurred",
		};
	}
}
