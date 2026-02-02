import { HTTPException } from "hono/http-exception";

import { logger } from "@llmgateway/logger";

import type {
	ModelDefinition,
	Provider,
	ProviderModelMapping,
	WebSearchTool,
} from "@llmgateway/models";

export interface ValidateModelCapabilitiesOptions {
	response_format?: {
		type: "text" | "json_object" | "json_schema";
	};
	reasoning_effort?: string;
	tools?: unknown[];
	tool_choice?: unknown;
	webSearchTool?: WebSearchTool;
}

/**
 * Validates that a model supports the requested capabilities.
 *
 * Checks JSON output, JSON schema output, reasoning, tools, and web search capabilities.
 * For "auto" and "custom" models, these checks are skipped as capabilities will be resolved dynamically.
 *
 * @throws HTTPException if the model doesn't support a requested capability
 */
export function validateModelCapabilities(
	modelInfo: ModelDefinition,
	requestedModel: string,
	requestedProvider: Provider | undefined,
	options: ValidateModelCapabilitiesOptions,
): void {
	const {
		response_format,
		reasoning_effort,
		tools,
		tool_choice,
		webSearchTool,
	} = options;

	// Validate JSON object output capability
	if (response_format?.type === "json_object") {
		const providersToCheck = requestedProvider
			? modelInfo.providers.filter(
					(p) => (p as ProviderModelMapping).providerId === requestedProvider,
				)
			: modelInfo.providers;

		const supportsJsonOutput = providersToCheck.some(
			(provider) => (provider as ProviderModelMapping).jsonOutput === true,
		);

		if (!supportsJsonOutput) {
			throw new HTTPException(400, {
				message: `Model ${requestedModel} does not support JSON output mode`,
			});
		}
	}

	// Validate JSON schema output capability
	if (response_format?.type === "json_schema") {
		const providersToCheck = requestedProvider
			? modelInfo.providers.filter(
					(p) => (p as ProviderModelMapping).providerId === requestedProvider,
				)
			: modelInfo.providers;

		// For non-auto/custom models, check if the provider supports json_schema
		if (requestedModel !== "auto" && requestedModel !== "custom") {
			const supportsJsonSchema = providersToCheck.some(
				(provider) =>
					(provider as ProviderModelMapping).jsonOutputSchema === true,
			);

			if (!supportsJsonSchema) {
				throw new HTTPException(400, {
					message: `Model ${requestedModel} does not support JSON schema output mode`,
				});
			}
		}
	}

	// Check if reasoning_effort is specified but model doesn't support reasoning
	// Skip this check for "auto" and "custom" models as they will be resolved dynamically
	if (
		reasoning_effort !== undefined &&
		requestedModel !== "auto" &&
		requestedModel !== "custom"
	) {
		const providersToCheck = requestedProvider
			? modelInfo.providers.filter(
					(p) => (p as ProviderModelMapping).providerId === requestedProvider,
				)
			: modelInfo.providers;

		const supportsReasoning = providersToCheck.some(
			(provider) => (provider as ProviderModelMapping).reasoning === true,
		);

		if (!supportsReasoning) {
			logger.error(
				`Reasoning effort specified for non-reasoning model: ${requestedModel}`,
				{
					requestedModel,
					requestedProvider,
					reasoning_effort,
					modelProviders: modelInfo.providers.map((p) => ({
						providerId: p.providerId,
						reasoning: (p as ProviderModelMapping).reasoning,
					})),
				},
			);

			throw new HTTPException(400, {
				message: `Model ${requestedModel} does not support reasoning. Remove the reasoning_effort parameter or use a reasoning-capable model.`,
			});
		}
	}

	// Check if tools are specified but model doesn't support them
	// Skip this check for "auto" and "custom" models as they will be resolved dynamically
	if (
		(tools !== undefined || tool_choice !== undefined) &&
		requestedModel !== "auto" &&
		requestedModel !== "custom"
	) {
		const providersToCheck = requestedProvider
			? modelInfo.providers.filter(
					(p) => (p as ProviderModelMapping).providerId === requestedProvider,
				)
			: modelInfo.providers;

		const supportsTools = providersToCheck.some(
			(provider) => (provider as ProviderModelMapping).tools === true,
		);

		const supportsWebSearch = providersToCheck.some(
			(provider) => (provider as ProviderModelMapping).webSearch === true,
		);

		// Determine if we have function tools (web_search tools were already extracted earlier)
		// After extraction, `tools` only contains function tools
		const hasFunctionTools = tools && tools.length > 0;

		// The request is web-search-only if:
		// 1. A web search tool was extracted (webSearchTool is set)
		// 2. No function tools remain in the tools array
		const isWebSearchOnly = webSearchTool !== undefined && !hasFunctionTools;

		// Allow the request if:
		// 1. Model supports regular tools, OR
		// 2. Model supports web search AND request only uses web search (no function tools)
		if (!supportsTools && !(supportsWebSearch && isWebSearchOnly)) {
			throw new HTTPException(400, {
				message: `Model ${requestedModel} does not support tool calls. Remove the tools/tool_choice parameter or use a tool-capable model.`,
			});
		}

		// If web_search tool is specifically requested, ensure the model supports it
		if (webSearchTool && !supportsWebSearch) {
			throw new HTTPException(400, {
				message: `Model ${requestedModel} does not support native web search. Remove the web_search tool or use a model that supports it. See https://llmgateway.io/models?features=webSearch for supported models.`,
			});
		}
	}
}
