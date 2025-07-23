import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import {
	models as modelsList,
	providers,
	type ProviderModelMapping,
	type ModelDefinition,
} from "@llmgateway/models";
import { HTTPException } from "hono/http-exception";

import type { ServerTypes } from "../vars";

export const modelsApi = new OpenAPIHono<ServerTypes>();

const modelSchema = z.object({
	id: z.string(),
	name: z.string(),
	created: z.number(),
	description: z.string().optional(),
	architecture: z.object({
		input_modalities: z.array(z.enum(["text", "image"])),
		output_modalities: z.array(z.enum(["text"])),
		tokenizer: z.string().optional(),
	}),
	top_provider: z.object({
		is_moderated: z.boolean(),
	}),
	providers: z.array(
		z.object({
			providerId: z.string(),
			modelName: z.string(),
			pricing: z
				.object({
					prompt: z.string(),
					completion: z.string(),
					image: z.string().optional(),
				})
				.optional(),
			streaming: z.boolean(),
			vision: z.boolean(),
			cancellation: z.boolean(),
		}),
	),
	pricing: z.object({
		prompt: z.string(),
		completion: z.string(),
		image: z.string().optional(),
		request: z.string().optional(),
		input_cache_read: z.string().optional(),
		input_cache_write: z.string().optional(),
		web_search: z.string().optional(),
		internal_reasoning: z.string().optional(),
	}),
	context_length: z.number().optional(),
	per_request_limits: z.record(z.string()).optional(),
	supported_parameters: z.array(z.string()).optional(),
	json_output: z.boolean(),
	deprecated_at: z.string().optional(),
	deactivated_at: z.string().optional(),
});

const listModelsResponseSchema = z.object({
	data: z.array(modelSchema),
});

const listModels = createRoute({
	operationId: "v1_models",
	summary: "Models",
	description: "List all available models",
	method: "get",
	path: "/",
	request: {},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: listModelsResponseSchema,
				},
			},
			description: "List of available models",
		},
	},
});

modelsApi.openapi(listModels, async (c) => {
	try {
		const modelData = modelsList.map((model: ModelDefinition) => {
			// Determine input modalities (if model supports images)
			const inputModalities: ("text" | "image")[] = ["text"];

			// Check if any provider has vision support
			if (model.providers.some((p) => p.vision)) {
				inputModalities.push("image");
			}

			const firstProviderWithPricing = model.providers.find(
				(p: ProviderModelMapping) =>
					p.inputPrice !== undefined ||
					p.outputPrice !== undefined ||
					p.imageInputPrice !== undefined,
			);

			const inputPrice =
				firstProviderWithPricing?.inputPrice?.toString() || "0";
			const outputPrice =
				firstProviderWithPricing?.outputPrice?.toString() || "0";
			const imagePrice =
				firstProviderWithPricing?.imageInputPrice?.toString() || "0";

			return {
				id: model.model,
				name: model.model,
				created: Math.floor(Date.now() / 1000), // Current timestamp in seconds
				description: `${model.model} provided by ${model.providers.map((p) => p.providerId).join(", ")}`,
				architecture: {
					input_modalities: inputModalities,
					output_modalities: ["text"] as ["text"],
					tokenizer: "GPT", // TODO: Should come from model definitions when available
				},
				top_provider: {
					is_moderated: true,
				},
				providers: model.providers.map((provider: ProviderModelMapping) => {
					// Find the provider definition to get cancellation support
					const providerDef = providers.find(
						(p) => p.id === provider.providerId,
					);

					return {
						providerId: provider.providerId,
						modelName: provider.modelName,
						pricing:
							provider.inputPrice !== undefined ||
							provider.outputPrice !== undefined ||
							provider.imageInputPrice !== undefined
								? {
										prompt: provider.inputPrice?.toString() || "0",
										completion: provider.outputPrice?.toString() || "0",
										image: provider.imageInputPrice?.toString() || "0",
									}
								: undefined,
						streaming: provider.streaming,
						vision: provider.vision || false,
						cancellation: providerDef?.cancellation || false,
					};
				}),
				pricing: {
					prompt: inputPrice,
					completion: outputPrice,
					image: imagePrice,
					request: firstProviderWithPricing?.requestPrice?.toString() || "0",
					input_cache_read:
						firstProviderWithPricing?.cachedInputPrice?.toString() || "0",
					input_cache_write: "0", // Not defined in model definitions yet
					web_search: "0", // Not defined in model definitions yet
					internal_reasoning: "0", // Not defined in model definitions yet
				},
				// Use context length from model definition (take the largest from all providers)
				context_length:
					Math.max(...model.providers.map((p) => p.contextSize || 0)) ||
					undefined,
				// TODO: supported_parameters should come from model definitions when available
				supported_parameters: getSupportedParameters(model.model),
				// Add model-level capabilities
				json_output: model.jsonOutput || false,
				deprecated_at: model.deprecatedAt?.toISOString(),
				deactivated_at: model.deactivatedAt?.toISOString(),
			};
		});

		return c.json({ data: modelData });
	} catch (error) {
		console.error("Error in models endpoint:", error);
		throw new HTTPException(500, { message: "Internal server error" });
	}
});

// Helper function to determine supported parameters based on model name
// TODO: This should be moved to model definitions instead of hardcoded logic
function getSupportedParameters(modelName: string): string[] {
	const baseParams = [
		"temperature",
		"max_tokens",
		"top_p",
		"frequency_penalty",
		"presence_penalty",
	];

	// Add model-specific parameters
	if (modelName.includes("gpt-4") || modelName.includes("gpt-3.5")) {
		baseParams.push("response_format", "tools");
	}

	if (modelName.includes("llama")) {
		baseParams.push("top_k");
	}

	return baseParams;
}
