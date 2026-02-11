import { logger } from "@llmgateway/logger";
import {
	models,
	type ProviderModelMapping,
	type ProviderId,
	type BaseMessage,
	type ProviderValidationResult,
} from "@llmgateway/models";

import { getCheapestModelForProvider } from "./get-cheapest-model-for-provider.js";
import { getProviderEndpoint } from "./get-provider-endpoint.js";
import { getProviderHeaders } from "./get-provider-headers.js";
import { prepareRequestBody } from "./prepare-request-body.js";

import type { ProviderKeyOptions } from "@llmgateway/db";

/**
 * Validate a provider API key by making a minimal request
 */
export async function validateProviderKey(
	provider: ProviderId,
	token: string,
	baseUrl?: string,
	skipValidation = false,
	providerKeyOptions?: ProviderKeyOptions,
): Promise<ProviderValidationResult> {
	// Skip validation if requested (e.g. in test environment)
	if (skipValidation) {
		return { valid: true };
	}

	// Skip validation for custom providers since they don't have predefined models
	if (provider === "custom") {
		return { valid: true };
	}

	let validationModel: string | undefined;

	try {
		// Determine the validation model first (needed for endpoint URL)
		if (provider === "azure" && providerKeyOptions?.azure_validation_model) {
			validationModel = providerKeyOptions.azure_validation_model;
			logger.debug("Using Azure validation model from options", {
				provider,
				validationModel,
			});
		} else if (provider === "openai") {
			validationModel = "gpt-4o-mini";
			logger.debug("Using fixed OpenAI validation model", {
				provider,
				validationModel,
			});
		} else if (provider === "google-ai-studio") {
			validationModel = "gemini-2.5-flash-lite";
			logger.debug("Using fixed Google AI Studio validation model", {
				provider,
				validationModel,
			});
		} else {
			const cheapestModel = getCheapestModelForProvider(provider);
			logger.debug("Using cheapest validation model", {
				provider,
				validationModel: cheapestModel || undefined,
			});
			if (!cheapestModel) {
				throw new Error(
					`No model with pricing information found for provider ${provider}`,
				);
			}
			validationModel = cheapestModel;
		}

		// Find the model definition to get the model ID
		// For Azure with custom validation model, we might not find it in our models list
		const modelDef = models.find((m) =>
			m.providers.some(
				(p) => p.providerId === provider && p.modelName === validationModel,
			),
		);
		const modelId = modelDef?.id;

		// For Azure, if we have a custom validation model, use it directly as modelId
		const effectiveModelId =
			provider === "azure" && providerKeyOptions?.azure_validation_model
				? providerKeyOptions.azure_validation_model
				: modelId;

		logger.debug("Validation endpoint configuration", {
			provider,
			validationModel,
			modelId,
			effectiveModelId,
			providerKeyOptions,
		});

		const endpoint = getProviderEndpoint(
			provider,
			baseUrl,
			effectiveModelId, // Pass model ID for providers that need it in the URL (e.g., aws-bedrock, azure)
			provider === "google-ai-studio" || provider === "google-vertex"
				? token
				: undefined,
			false, // validation doesn't need streaming
			false, // supportsReasoning - disable for validation
			false, // hasExistingToolCalls - disable for validation
			providerKeyOptions,
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
			supportedParameters?.includes("max_tokens") &&
			providerMapping?.providerId !== "azure";

		const useResponsesApi = endpoint.includes("/responses");

		const payload = await prepareRequestBody(
			provider,
			validationModel,
			messages,
			false, // stream
			undefined, // temperature
			supportsMaxTokens ? 10 : undefined, // max_tokens - minimal for validation, undefined if not supported
			undefined, // top_p
			undefined, // frequency_penalty
			undefined, // presence_penalty
			undefined, // response_format
			undefined, // tools
			undefined, // tool_choice
			undefined, // reasoning_effort
			false, // supportsReasoning - disable for validation
			false, // isProd - allow http URLs for validation/testing
			20, // maxImageSizeMB
			null, // userPlan
			undefined, // sensitive_word_check
			undefined, // image_config
			undefined, // effort
			undefined, // imageGenerations
			undefined, // webSearchTool
			useResponsesApi,
		);

		const headers = getProviderHeaders(provider, token);
		headers["Content-Type"] = "application/json";

		logger.debug("Sending provider key validation request", {
			provider,
			model: validationModel,
			endpoint,
		});

		const response = await fetch(endpoint, {
			method: "POST",
			headers,
			body: JSON.stringify(payload),
		});

		if (!response.ok) {
			const errorText = await response.text();
			let errorMessage = `${response.status} ${response.statusText}`;

			try {
				const errorJson = JSON.parse(errorText);
				if (errorJson.error?.message) {
					errorMessage = errorJson.error.message;
				} else if (errorJson.message) {
					errorMessage = errorJson.message;
				}
			} catch {}

			logger.warn("Provider key validation returned error response", {
				provider,
				model: validationModel,
				statusCode: response.status,
				error: errorMessage,
			});

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

		logger.debug("Provider key validation succeeded", {
			provider,
			model: validationModel,
		});
		return { valid: true, model: validationModel };
	} catch (error) {
		const errorMessage =
			error instanceof Error ? error.message : "Unknown error occurred";
		logger.error("Provider key validation failed with exception", {
			provider,
			model: validationModel,
			error: errorMessage,
			stack: error instanceof Error ? error.stack : undefined,
		});
		return {
			valid: false,
			error: errorMessage,
			model: validationModel,
		};
	}
}
