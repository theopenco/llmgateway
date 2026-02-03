import {
	type ModelDefinition,
	models,
	type ProviderModelMapping,
	type ProviderId,
	type BaseMessage,
	type FunctionParameter,
	type OpenAIFunctionToolInput,
	type OpenAIRequestBody,
	type OpenAIResponsesRequestBody,
	type OpenAIToolInput,
	type ProviderRequestBody,
	type ToolChoiceType,
	type WebSearchTool,
} from "@llmgateway/models";

import { transformAnthropicMessages } from "./transform-anthropic-messages.js";
import { transformGoogleMessages } from "./transform-google-messages.js";

/**
 * Type guard to check if a tool is a function tool
 */
function isFunctionTool(
	tool: OpenAIToolInput,
): tool is OpenAIFunctionToolInput {
	return tool.type === "function";
}

/**
 * Converts OpenAI JSON schema format to Google's schema format
 * Google uses uppercase type names (STRING, OBJECT, ARRAY) vs OpenAI's lowercase (string, object, array)
 */
function convertOpenAISchemaToGoogle(schema: any): any {
	if (!schema || typeof schema !== "object") {
		return schema;
	}

	const converted: any = {};

	// Convert type to uppercase
	if (schema.type) {
		converted.type = schema.type.toUpperCase();
	}

	// Copy description if present
	if (schema.description) {
		converted.description = schema.description;
	}

	// Handle object properties
	if (schema.properties) {
		converted.properties = {};
		for (const [key, value] of Object.entries(schema.properties)) {
			converted.properties[key] = convertOpenAISchemaToGoogle(value);
		}
	}

	// Handle array items
	if (schema.items) {
		converted.items = convertOpenAISchemaToGoogle(schema.items);
	}

	// Copy required array if present
	if (schema.required) {
		converted.required = schema.required;
	}

	// Copy enum if present
	if (schema.enum) {
		converted.enum = schema.enum;
	}

	// Copy other common JSON schema properties that Google supports
	if (schema.format) {
		converted.format = schema.format;
	}

	// Note: Google doesn't support additionalProperties in the same way as OpenAI
	// We skip it here as it's not part of Google's schema format

	return converted;
}

/**
 * Recursively sanitizes schemas for Cerebras:
 * - Ensures additionalProperties: false is set on all object schemas
 * - Removes unsupported string validation fields (format, minLength, maxLength, pattern)
 */
function sanitizeCerebrasSchema(schema: any): any {
	if (!schema || typeof schema !== "object") {
		return schema;
	}

	if (Array.isArray(schema)) {
		return schema.map((item) => sanitizeCerebrasSchema(item));
	}

	const result: any = { ...schema };

	// If this is an object type schema, ensure additionalProperties is false
	if (result.type === "object") {
		result.additionalProperties = false;
	}

	// Remove unsupported string validation fields (Cerebras doesn't support them)
	if (result.type === "string") {
		delete result.format;
		delete result.minLength;
		delete result.maxLength;
		delete result.pattern;
	}

	// Recursively process properties
	if (result.properties) {
		result.properties = Object.fromEntries(
			Object.entries(result.properties).map(([key, value]) => [
				key,
				sanitizeCerebrasSchema(value),
			]),
		);
	}

	// Recursively process items (for arrays)
	if (result.items) {
		result.items = sanitizeCerebrasSchema(result.items);
	}

	// Recursively process anyOf, oneOf, allOf
	for (const key of ["anyOf", "oneOf", "allOf"]) {
		if (result[key] && Array.isArray(result[key])) {
			result[key] = result[key].map((item: any) =>
				sanitizeCerebrasSchema(item),
			);
		}
	}

	// Recursively process $defs/definitions
	if (result.$defs) {
		result.$defs = Object.fromEntries(
			Object.entries(result.$defs).map(([key, value]) => [
				key,
				sanitizeCerebrasSchema(value),
			]),
		);
	}
	if (result.definitions) {
		result.definitions = Object.fromEntries(
			Object.entries(result.definitions).map(([key, value]) => [
				key,
				sanitizeCerebrasSchema(value),
			]),
		);
	}

	return result;
}

/**
 * Resolves a $ref path like "#/$defs/QuestionOption" to the actual definition
 */
function resolveRef(ref: string, rootDefs: Record<string, any>): any {
	// Handle JSON Pointer format: #/$defs/Name or #/definitions/Name
	const match = ref.match(/^#\/(\$defs|definitions)\/(.+)$/);
	if (match) {
		const defName = match[2];
		return rootDefs[defName];
	}
	return null;
}

/**
 * Recursively strips unsupported properties and expands $ref references for Google
 * Google doesn't support $ref, additionalProperties, $schema, and some other JSON schema properties
 */
function stripUnsupportedSchemaProperties(
	schema: any,
	rootDefs?: Record<string, any>,
): any {
	if (!schema || typeof schema !== "object") {
		return schema;
	}

	if (Array.isArray(schema)) {
		return schema.map((item) =>
			stripUnsupportedSchemaProperties(item, rootDefs),
		);
	}

	// Extract $defs or definitions from root schema if present (only on first call)
	const defs = rootDefs ?? schema.$defs ?? schema.definitions ?? {};

	// Handle $ref - expand the reference inline
	if (schema.$ref) {
		const resolved = resolveRef(schema.$ref, defs);
		if (resolved) {
			// Expand the reference, preserving only description and default from the original node
			const expanded = stripUnsupportedSchemaProperties({ ...resolved }, defs);
			if (schema.description && !expanded.description) {
				expanded.description = schema.description;
			}
			if (schema.default !== undefined && expanded.default === undefined) {
				expanded.default = schema.default;
			}
			return expanded;
		}
		// If reference couldn't be resolved, remove $ref and continue
	}

	const cleaned: any = {};

	for (const [key, value] of Object.entries(schema)) {
		// Skip unsupported properties
		// Google doesn't support: additionalProperties, $schema, $defs, definitions, $ref, ref (non-standard), maxLength, minLength, minimum, maximum, pattern
		if (
			key === "additionalProperties" ||
			key === "$schema" ||
			key === "$defs" ||
			key === "definitions" ||
			key === "$ref" ||
			key === "ref" ||
			key === "maxLength" ||
			key === "minLength" ||
			key === "minimum" ||
			key === "maximum" ||
			key === "pattern"
		) {
			continue;
		}

		// Recursively clean nested objects
		if (value && typeof value === "object") {
			cleaned[key] = stripUnsupportedSchemaProperties(value, defs);
		} else {
			cleaned[key] = value;
		}
	}

	// Filter 'required' array to only include properties that exist in 'properties'
	if (
		cleaned.required &&
		Array.isArray(cleaned.required) &&
		cleaned.properties
	) {
		const existingProps = Object.keys(cleaned.properties);
		cleaned.required = cleaned.required.filter((prop: string) =>
			existingProps.includes(prop),
		);
		// Remove empty required array
		if (cleaned.required.length === 0) {
			delete cleaned.required;
		}
	}

	return cleaned;
}

/**
 * Transforms messages for models that don't support system roles by converting system messages to user messages
 */
function transformMessagesForNoSystemRole(messages: any[]): any[] {
	return messages.map((message) => {
		if (message.role === "system") {
			return {
				...message,
				role: "user",
			};
		}
		return message;
	});
}

/**
 * Transforms message content types for OpenAI's Responses API.
 * The Responses API uses different content type identifiers:
 * - "text" -> "input_text" (for user/system/tool messages) or "output_text" (for assistant messages)
 * - "image_url" -> "input_image"
 */
function transformContentForResponsesApi(content: any, role: string): any {
	// Handle string content - wrap it in the appropriate format
	if (typeof content === "string") {
		if (role === "assistant") {
			return [{ type: "output_text", text: content }];
		}
		return [{ type: "input_text", text: content }];
	}

	// Handle array content
	if (Array.isArray(content)) {
		return content.map((part: any) => {
			if (part.type === "text") {
				// Transform "text" to "input_text" or "output_text" based on role
				if (role === "assistant") {
					return { type: "output_text", text: part.text };
				}
				return { type: "input_text", text: part.text };
			}
			if (part.type === "image_url") {
				// Transform "image_url" to "input_image"
				// The Responses API expects the image URL directly or base64 data
				const imageUrl = part.image_url?.url || part.image_url;

				// Check if it's a base64 data URL
				if (typeof imageUrl === "string" && imageUrl.startsWith("data:")) {
					// Parse data URL: data:image/jpeg;base64,/9j/4AAQ...
					const matches = imageUrl.match(/^data:([^;]+);base64,(.+)$/);
					if (matches) {
						return {
							type: "input_image",
							image_url: imageUrl,
						};
					}
				}

				// For regular URLs, pass directly
				return {
					type: "input_image",
					image_url: imageUrl,
				};
			}
			// Return other content types as-is (they may need additional handling)
			return part;
		});
	}

	// Return as-is if not string or array
	return content;
}

/**
 * Transforms messages for OpenAI's Responses API format.
 * This includes:
 * - Converting content types (text -> input_text/output_text, image_url -> input_image)
 * - Removing unsupported fields (tool_calls, tool_call_id)
 * - Converting tool role to user role
 */
function transformMessagesForResponsesApi(messages: any[]): any[] {
	return messages.map((msg: any) => {
		const transformed: any = {
			role: msg.role,
		};

		// Responses API doesn't support 'tool' role - convert to 'user'
		if (transformed.role === "tool") {
			transformed.role = "user";
		}

		// Transform content types
		transformed.content = transformContentForResponsesApi(
			msg.content,
			transformed.role,
		);

		// Copy name if present (for developer/system messages)
		if (msg.name) {
			transformed.name = msg.name;
		}

		// Note: tool_calls and tool_call_id are intentionally NOT copied
		// as they are not supported in Responses API input

		return transformed;
	});
}

/**
 * Prepares the request body for different providers
 */
export async function prepareRequestBody(
	usedProvider: ProviderId,
	usedModel: string,
	messages: BaseMessage[],
	stream: boolean,
	temperature: number | undefined,
	max_tokens: number | undefined,
	top_p: number | undefined,
	frequency_penalty: number | undefined,
	presence_penalty: number | undefined,
	response_format: OpenAIRequestBody["response_format"],
	tools?: OpenAIToolInput[],
	tool_choice?: ToolChoiceType,
	reasoning_effort?: "minimal" | "low" | "medium" | "high",
	supportsReasoning?: boolean,
	isProd = false,
	maxImageSizeMB = 20,
	userPlan: "free" | "pro" | "enterprise" | null = null,
	sensitive_word_check?: { status: "DISABLE" | "ENABLE" },
	image_config?: {
		aspect_ratio?: string;
		image_size?: string;
		n?: number;
		seed?: number;
	},
	effort?: "low" | "medium" | "high",
	imageGenerations?: boolean,
	webSearchTool?: WebSearchTool,
): Promise<ProviderRequestBody> {
	// Handle Z.AI image generation models
	if (imageGenerations && usedProvider === "zai") {
		// Extract prompt from last user message
		const lastUserMessage = [...messages]
			.reverse()
			.find((m) => m.role === "user");
		let prompt = "";
		if (lastUserMessage) {
			if (typeof lastUserMessage.content === "string") {
				prompt = lastUserMessage.content;
			} else if (Array.isArray(lastUserMessage.content)) {
				prompt = lastUserMessage.content
					.filter((p): p is { type: "text"; text: string } => p.type === "text")
					.map((p) => p.text)
					.join("\n");
			}
		}

		// Z.AI CogView uses OpenAI-compatible image generation format
		const zaiImageRequest: any = {
			model: usedModel,
			prompt,
			...(image_config?.image_size && { size: image_config.image_size }),
			...(image_config?.n && { n: image_config.n }),
		};

		return zaiImageRequest;
	}

	// Handle Alibaba image generation models
	if (imageGenerations && usedProvider === "alibaba") {
		// Extract prompt from last user message
		const lastUserMessage = [...messages]
			.reverse()
			.find((m) => m.role === "user");
		let prompt = "";
		if (lastUserMessage) {
			if (typeof lastUserMessage.content === "string") {
				prompt = lastUserMessage.content;
			} else if (Array.isArray(lastUserMessage.content)) {
				prompt = lastUserMessage.content
					.filter((p): p is { type: "text"; text: string } => p.type === "text")
					.map((p) => p.text)
					.join("\n");
			}
		}

		// Alibaba DashScope multimodal generation format
		const alibabaImageRequest: any = {
			model: usedModel,
			input: {
				messages: [
					{
						role: "user",
						content: [{ text: prompt }],
					},
				],
			},
			parameters: {
				watermark: false,
				...(image_config?.n && { n: image_config.n }),
				...(image_config?.seed !== undefined && { seed: image_config.seed }),
			},
		};

		// Map image_size to Alibaba format (uses * instead of x)
		if (image_config?.image_size) {
			alibabaImageRequest.parameters.size = image_config.image_size.replace(
				"x",
				"*",
			);
		}

		return alibabaImageRequest;
	}

	// Handle ByteDance Seedream image generation
	if (imageGenerations && usedProvider === "bytedance") {
		// Extract prompt from last user message
		const lastUserMessage = [...messages]
			.reverse()
			.find((m) => m.role === "user");
		let prompt = "";
		if (lastUserMessage) {
			if (typeof lastUserMessage.content === "string") {
				prompt = lastUserMessage.content;
			} else if (Array.isArray(lastUserMessage.content)) {
				prompt = lastUserMessage.content
					.filter((p): p is { type: "text"; text: string } => p.type === "text")
					.map((p) => p.text)
					.join("\n");
			}
		}

		// ByteDance Seedream format
		const bytedanceImageRequest: any = {
			model: usedModel,
			prompt,
			...(image_config?.image_size && { size: image_config.image_size }),
		};

		return bytedanceImageRequest;
	}

	// Check if the model supports system role
	// Look up by model ID first, then fall back to provider modelName
	const modelDef = models.find(
		(m) =>
			m.id === usedModel ||
			m.providers.some(
				(p) => p.modelName === usedModel && p.providerId === usedProvider,
			),
	);
	const supportsSystemRole =
		(modelDef as ModelDefinition)?.supportsSystemRole !== false;

	// Transform messages if model doesn't support system role
	let processedMessages = messages;
	if (!supportsSystemRole) {
		processedMessages = transformMessagesForNoSystemRole(messages);
	}

	// Start with a base structure that can be modified for each provider
	const requestBody: any = {
		model: usedModel,
		messages: processedMessages,
		stream: stream,
	};
	// Filter to only function tools for the base request body
	// (web_search tools are extracted and handled separately via webSearchTool parameter)
	if (tools && tools.length > 0) {
		const functionTools = tools.filter(isFunctionTool);
		if (functionTools.length > 0) {
			requestBody.tools = functionTools;
		}
	}

	if (tool_choice) {
		requestBody.tool_choice = tool_choice;
	}

	// Override temperature to 1 for GPT-5 models (they only support temperature = 1)
	if (usedModel.startsWith("gpt-5")) {
		// eslint-disable-next-line no-param-reassign
		temperature = 1;
	}

	// OpenAI family models require max_tokens >= 16
	if (
		modelDef?.family === "openai" &&
		max_tokens !== undefined &&
		max_tokens < 16
	) {
		// eslint-disable-next-line no-param-reassign
		max_tokens = 16;
	}

	switch (usedProvider) {
		case "openai": {
			// Check if the model supports responses API
			const providerMapping = modelDef?.providers.find(
				(p) => p.providerId === "openai",
			);
			const supportsResponsesApi =
				(providerMapping as ProviderModelMapping)?.supportsResponsesApi ===
				true;

			if (supportsResponsesApi) {
				// Transform to responses API format
				// gpt-5-pro only supports "high" reasoning effort
				const defaultEffort = usedModel === "gpt-5-pro" ? "high" : "medium";

				// Transform messages for responses API:
				// - Convert content types (text -> input_text/output_text, image_url -> input_image)
				// - Remove tool_calls and tool_call_id (not supported)
				// - Convert tool role to user role
				const transformedMessages =
					transformMessagesForResponsesApi(processedMessages);

				const responsesBody: OpenAIResponsesRequestBody = {
					model: usedModel,
					input: transformedMessages,
					reasoning: {
						effort: reasoning_effort || defaultEffort,
						summary: "detailed",
					},
				};

				// Add streaming support
				if (stream) {
					responsesBody.stream = true;
				}

				// Add tools support for responses API (transform format if needed)
				if (tools && tools.length > 0) {
					// Filter to only function tools (web_search is handled separately)
					const functionTools = tools.filter(isFunctionTool);
					if (functionTools.length > 0) {
						// Transform tools from chat completions format to responses API format
						responsesBody.tools = functionTools.map((tool) => ({
							type: "function" as const,
							name: tool.function.name,
							description: tool.function.description,
							parameters: tool.function.parameters as FunctionParameter,
						}));
					}
				}

				// Add web search tool for Responses API
				if (webSearchTool) {
					if (!responsesBody.tools) {
						responsesBody.tools = [];
					}
					const webSearch: any = { type: "web_search" };
					if (webSearchTool.user_location) {
						webSearch.user_location = webSearchTool.user_location;
					}
					if (webSearchTool.search_context_size) {
						webSearch.search_context_size = webSearchTool.search_context_size;
					}
					responsesBody.tools.push(webSearch);
				}
				if (tool_choice) {
					responsesBody.tool_choice = tool_choice;
				}

				// Add optional parameters if they are provided
				if (temperature !== undefined) {
					responsesBody.temperature = temperature;
				}
				if (max_tokens !== undefined) {
					responsesBody.max_output_tokens = max_tokens;
				}

				// Handle response_format for Responses API - transform to text.format
				if (response_format) {
					if (
						response_format.type === "json_schema" &&
						response_format.json_schema
					) {
						responsesBody.text = {
							format: {
								type: "json_schema",
								name: response_format.json_schema.name,
								schema: response_format.json_schema.schema as Record<
									string,
									unknown
								>,
								strict: response_format.json_schema.strict,
							},
						};
					} else if (response_format.type === "json_object") {
						responsesBody.text = {
							format: { type: "json_object" },
						};
					}
				}

				return responsesBody;
			} else {
				// Use regular chat completions format
				if (stream) {
					requestBody.stream_options = {
						include_usage: true,
					};
				}
				if (response_format) {
					requestBody.response_format = response_format;
				}

				// Add web search for OpenAI Chat Completions
				// For search models (gpt-4o-search-preview, gpt-4o-mini-search-preview), use web_search_options
				// For other models that support web search, add web_search tool
				if (webSearchTool) {
					if (usedModel.includes("-search-")) {
						// Search models use web_search_options parameter
						const webSearchOptions: any = {};
						if (webSearchTool.user_location) {
							webSearchOptions.user_location = {
								type: "approximate",
								approximate: {
									city: webSearchTool.user_location.city,
									region: webSearchTool.user_location.region,
									country: webSearchTool.user_location.country,
								},
							};
						}
						if (webSearchTool.search_context_size) {
							webSearchOptions.search_context_size =
								webSearchTool.search_context_size;
						}
						requestBody.web_search_options =
							Object.keys(webSearchOptions).length > 0 ? webSearchOptions : {};
					} else {
						// Regular models with web search support use web_search tool
						if (!requestBody.tools) {
							requestBody.tools = [];
						}
						const webSearch: any = { type: "web_search" };
						if (webSearchTool.user_location) {
							webSearch.user_location = webSearchTool.user_location;
						}
						if (webSearchTool.search_context_size) {
							webSearch.search_context_size = webSearchTool.search_context_size;
						}
						requestBody.tools.push(webSearch);
					}
				}

				// Add optional parameters if they are provided
				if (temperature !== undefined) {
					requestBody.temperature = temperature;
				}
				if (max_tokens !== undefined) {
					// GPT-5 models use max_completion_tokens instead of max_tokens
					if (usedModel.startsWith("gpt-5")) {
						requestBody.max_completion_tokens = max_tokens;
					} else {
						requestBody.max_tokens = max_tokens;
					}
				}
				if (top_p !== undefined) {
					requestBody.top_p = top_p;
				}
				if (frequency_penalty !== undefined) {
					requestBody.frequency_penalty = frequency_penalty;
				}
				if (presence_penalty !== undefined) {
					requestBody.presence_penalty = presence_penalty;
				}
				if (reasoning_effort !== undefined) {
					requestBody.reasoning_effort = reasoning_effort;
				}
			}
			break;
		}
		case "zai": {
			if (stream) {
				requestBody.stream_options = {
					include_usage: true,
				};
			}
			if (response_format) {
				requestBody.response_format = response_format;
			}

			// Add web search tool for ZAI
			// ZAI uses a web_search tool with enable flag and search_engine config
			if (webSearchTool) {
				if (!requestBody.tools) {
					requestBody.tools = [];
				}
				requestBody.tools.push({
					type: "web_search",
					web_search: {
						enable: true,
						search_engine: "search-prime",
					},
				});
			}

			// Add optional parameters if they are provided
			if (temperature !== undefined) {
				requestBody.temperature = temperature;
			}
			if (max_tokens !== undefined) {
				requestBody.max_tokens = max_tokens;
			}
			if (top_p !== undefined) {
				requestBody.top_p = top_p;
			}
			if (frequency_penalty !== undefined) {
				requestBody.frequency_penalty = frequency_penalty;
			}
			if (presence_penalty !== undefined) {
				requestBody.presence_penalty = presence_penalty;
			}
			// ZAI/GLM models use 'thinking' parameter for reasoning instead of 'reasoning_effort'
			if (supportsReasoning) {
				requestBody.thinking = {
					type: "enabled",
				};
			}
			// Add sensitive_word_check if provided (Z.ai specific)
			if (sensitive_word_check) {
				requestBody.sensitive_word_check = sensitive_word_check;
			}
			break;
		}
		case "anthropic": {
			// Remove generic tool_choice that was added earlier
			delete requestBody.tool_choice;

			// Set max_tokens, ensuring it's higher than thinking budget when reasoning is enabled
			const getThinkingBudget = (effort?: string) => {
				if (!supportsReasoning) {
					return 0;
				}
				if (!reasoning_effort) {
					return 0;
				}
				switch (effort) {
					case "low":
						return 1024; // Anthropic minimum
					case "high":
						return 4000;
					default:
						return 2000; // medium or undefined
				}
			};
			const thinkingBudget = getThinkingBudget(reasoning_effort);
			const minMaxTokens = Math.max(1024, thinkingBudget + 1000);
			requestBody.max_tokens = max_tokens ?? minMaxTokens;

			// Extract system messages for Anthropic's system field (required for prompt caching)
			const systemMessages = processedMessages.filter(
				(m) => m.role === "system",
			);
			const nonSystemMessages = processedMessages.filter(
				(m) => m.role !== "system",
			);

			// Build the system field with cache_control for long prompts
			// Track cache_control usage across system and user messages (max 4 total per Anthropic's limit)
			let systemCacheControlCount = 0;
			const maxCacheControlBlocks = 4;

			// Get the minCacheableTokens from the model definition (default to 1024 if not specified)
			const providerMapping = modelDef?.providers.find(
				(p) => p.providerId === usedProvider,
			) as ProviderModelMapping | undefined;
			const minCacheableTokens = providerMapping?.minCacheableTokens ?? 1024;
			// Approximate 4 characters per token
			const minCacheableChars = minCacheableTokens * 4;

			if (systemMessages.length > 0) {
				const systemContent: Array<{
					type: "text";
					text: string;
					cache_control?: { type: "ephemeral" };
				}> = [];

				for (const sysMsg of systemMessages) {
					let text: string;
					if (typeof sysMsg.content === "string") {
						text = sysMsg.content;
					} else if (Array.isArray(sysMsg.content)) {
						// Concatenate text from array content
						text = sysMsg.content
							.filter((c) => c.type === "text" && "text" in c)
							.map((c) => (c as { type: "text"; text: string }).text)
							.join("");
					} else {
						continue;
					}

					if (!text || text.trim() === "") {
						continue;
					}

					// Add cache_control for text blocks exceeding the model's minimum cacheable threshold
					const shouldCache =
						text.length >= minCacheableChars &&
						systemCacheControlCount < maxCacheControlBlocks;

					if (shouldCache) {
						systemCacheControlCount++;
						systemContent.push({
							type: "text",
							text,
							cache_control: { type: "ephemeral" },
						});
					} else {
						systemContent.push({
							type: "text",
							text,
						});
					}
				}

				if (systemContent.length > 0) {
					requestBody.system = systemContent;
				}
			}

			requestBody.messages = await transformAnthropicMessages(
				nonSystemMessages.map((m) => ({
					...m, // Preserve original properties for transformation
					role:
						m.role === "assistant"
							? "assistant"
							: m.role === "tool"
								? "user" // Tool results become user messages in Anthropic
								: "user",
					content: m.content,
					tool_calls: m.tool_calls, // Include tool_calls for transformation
				})),
				isProd,
				usedProvider,
				usedModel,
				maxImageSizeMB,
				userPlan,
				systemCacheControlCount, // Pass count to respect the 4 block limit
				minCacheableChars, // Model-specific minimum cacheable characters
			);

			// Transform tools from OpenAI format to Anthropic format
			if (tools && tools.length > 0) {
				// Filter to only function tools (web_search is handled separately)
				const functionTools = tools.filter(isFunctionTool);
				if (functionTools.length > 0) {
					requestBody.tools = functionTools.map((tool) => ({
						name: tool.function.name,
						description: tool.function.description,
						input_schema: tool.function.parameters,
					}));
				}
			}

			// Add web search tool for Anthropic
			// Anthropic uses the web_search_20250305 tool type
			if (webSearchTool) {
				if (!requestBody.tools) {
					requestBody.tools = [];
				}
				const webSearch: any = {
					type: "web_search_20250305",
					name: "web_search",
				};
				if (webSearchTool.max_uses) {
					webSearch.max_uses = webSearchTool.max_uses;
				}
				requestBody.tools.push(webSearch);
			}

			// Handle tool_choice parameter - transform OpenAI format to Anthropic format
			if (tool_choice) {
				if (
					typeof tool_choice === "object" &&
					tool_choice.type === "function"
				) {
					// Transform OpenAI format to Anthropic format
					requestBody.tool_choice = {
						type: "tool",
						name: tool_choice.function.name,
					};
				} else if (tool_choice === "auto") {
					// "auto" is the default behavior for Anthropic, omit it
					// Anthropic doesn't need explicit "auto" tool_choice
				} else if (tool_choice === "none") {
					// "none" should work as-is
					requestBody.tool_choice = tool_choice;
				} else {
					// Other string values (though not standard)
					requestBody.tool_choice = tool_choice;
				}
			}

			// Enable thinking for reasoning-capable Anthropic models when reasoning_effort is specified
			if (supportsReasoning && reasoning_effort) {
				requestBody.thinking = {
					type: "enabled",
					budget_tokens: thinkingBudget,
				};
			}

			// Add optional parameters if they are provided
			if (temperature !== undefined) {
				requestBody.temperature = temperature;
			}
			if (top_p !== undefined) {
				requestBody.top_p = top_p;
			}
			// Note: frequency_penalty and presence_penalty are NOT supported by Anthropic's Messages API
			if (effort !== undefined) {
				if (!requestBody.output_config) {
					requestBody.output_config = {};
				}
				requestBody.output_config.effort = effort;
			}

			// Handle response_format for Anthropic - transform to output_format
			// Anthropic uses output_format with type: "json_schema" and a schema object
			if (response_format) {
				if (
					response_format.type === "json_schema" &&
					response_format.json_schema
				) {
					// Ensure schema has additionalProperties: false as required by Anthropic
					const schema = {
						...response_format.json_schema.schema,
						additionalProperties: false,
					} as Record<string, unknown>;
					requestBody.output_format = {
						type: "json_schema",
						schema,
					};
				} else if (response_format.type === "json_object") {
					// For json_object, we cannot use structured outputs directly
					// as Anthropic requires a specific schema. Instead, we skip output_format
					// and rely on system prompt instructions for JSON output.
					// Note: The model capability (jsonOutput) should ensure the prompt guides JSON output.
				}
			}
			break;
		}
		case "aws-bedrock": {
			// AWS Bedrock uses the Converse API format
			delete requestBody.model; // Model is in the URL path
			delete requestBody.stream; // Will be added to inferenceConfig
			delete requestBody.messages; // Will be transformed to Bedrock format
			delete requestBody.tools; // Will be transformed to Bedrock format
			delete requestBody.tool_choice; // Not supported in Bedrock Converse API

			// Track cache control usage (max 4 blocks per Anthropic/Bedrock limit)
			let bedrockCacheControlCount = 0;
			const bedrockMaxCacheControlBlocks = 4;

			// Get the minCacheableTokens from the model definition (default to 1024 if not specified)
			const bedrockProviderMapping = modelDef?.providers.find(
				(p) => p.providerId === usedProvider,
			) as ProviderModelMapping | undefined;
			const bedrockMinCacheableTokens =
				bedrockProviderMapping?.minCacheableTokens ?? 1024;
			// Approximate 4 characters per token
			const bedrockMinCacheableChars = bedrockMinCacheableTokens * 4;

			// Extract system messages for Bedrock's system field (required for prompt caching)
			const bedrockSystemMessages = processedMessages.filter(
				(m) => m.role === "system",
			);
			const bedrockNonSystemMessages = processedMessages.filter(
				(m) => m.role !== "system",
			);

			// Build the system field with cachePoint for long prompts
			// AWS Bedrock uses "cachePoint" (not "cacheControl") as a SEPARATE content block after the text block
			if (bedrockSystemMessages.length > 0) {
				const systemContent: Array<
					{ text: string } | { cachePoint: { type: "default" } }
				> = [];

				for (const sysMsg of bedrockSystemMessages) {
					let text: string;
					if (typeof sysMsg.content === "string") {
						text = sysMsg.content;
					} else if (Array.isArray(sysMsg.content)) {
						text = sysMsg.content
							.filter((c: any) => c.type === "text" && "text" in c)
							.map((c: any) => c.text)
							.join("");
					} else {
						continue;
					}

					if (!text || text.trim() === "") {
						continue;
					}

					// Add text block first
					systemContent.push({ text });

					// Add cachePoint as separate block for long text (model-specific threshold)
					const shouldCache =
						text.length >= bedrockMinCacheableChars &&
						bedrockCacheControlCount < bedrockMaxCacheControlBlocks;

					if (shouldCache) {
						bedrockCacheControlCount++;
						systemContent.push({ cachePoint: { type: "default" } });
					}
				}

				if (systemContent.length > 0) {
					requestBody.system = systemContent;
				}
			}

			// Transform non-system messages to Bedrock format
			requestBody.messages = bedrockNonSystemMessages.map((msg: any) => {
				// Map OpenAI roles to Bedrock roles
				const role =
					msg.role === "user" || msg.role === "tool" ? "user" : "assistant";

				const bedrockMessage: any = {
					role: role,
					content: [],
				};

				// Handle tool results (from role: "tool")
				if (msg.role === "tool") {
					bedrockMessage.content.push({
						toolResult: {
							toolUseId: msg.tool_call_id,
							content: [
								{
									text: msg.content || "",
								},
							],
						},
					});
					return bedrockMessage;
				}

				// Handle assistant messages with tool calls
				if (msg.role === "assistant" && msg.tool_calls) {
					// Add text content if present
					if (msg.content) {
						bedrockMessage.content.push({
							text: msg.content,
						});
					}

					// Add tool use blocks
					msg.tool_calls.forEach((toolCall: any) => {
						bedrockMessage.content.push({
							toolUse: {
								toolUseId: toolCall.id,
								name: toolCall.function.name,
								input: JSON.parse(toolCall.function.arguments),
							},
						});
					});

					return bedrockMessage;
				}

				// Handle regular content (user/assistant messages)
				// AWS Bedrock uses "cachePoint" (not "cacheControl") as a SEPARATE content block after the text block
				if (typeof msg.content === "string") {
					if (msg.content.trim()) {
						// Add text block first
						bedrockMessage.content.push({
							text: msg.content,
						});

						// Add cachePoint as separate block for long user messages (model-specific threshold)
						const shouldCache =
							msg.content.length >= bedrockMinCacheableChars &&
							bedrockCacheControlCount < bedrockMaxCacheControlBlocks;

						if (shouldCache) {
							bedrockCacheControlCount++;
							bedrockMessage.content.push({
								cachePoint: { type: "default" },
							});
						}
					}
				} else if (Array.isArray(msg.content)) {
					// Handle multi-part content (text + images)
					msg.content.forEach((part: any) => {
						if (part.type === "text") {
							if (part.text && part.text.trim()) {
								// Add text block first
								bedrockMessage.content.push({
									text: part.text,
								});

								// Add cachePoint as separate block for long text parts (model-specific threshold)
								const shouldCache =
									part.text.length >= bedrockMinCacheableChars &&
									bedrockCacheControlCount < bedrockMaxCacheControlBlocks;

								if (shouldCache) {
									bedrockCacheControlCount++;
									bedrockMessage.content.push({
										cachePoint: { type: "default" },
									});
								}
							}
						} else if (part.type === "image_url") {
							// Bedrock uses a different image format
							// For now, skip images or handle them differently
							// This would need additional implementation for vision support
						}
					});
				}

				return bedrockMessage;
			});

			// Transform tools from OpenAI format to Bedrock format
			if (tools && tools.length > 0) {
				// Filter to only function tools (web_search is handled separately)
				const functionTools = tools.filter(isFunctionTool);
				if (functionTools.length > 0) {
					requestBody.toolConfig = {
						tools: functionTools.map((tool) => ({
							toolSpec: {
								name: tool.function.name,
								description: tool.function.description,
								inputSchema: {
									json: tool.function.parameters,
								},
							},
						})),
					};
				}
			}

			// Add inferenceConfig for optional parameters
			const inferenceConfig: any = {};
			if (temperature !== undefined) {
				inferenceConfig.temperature = temperature;
			}
			if (max_tokens !== undefined) {
				inferenceConfig.maxTokens = max_tokens;
			}
			if (top_p !== undefined) {
				inferenceConfig.topP = top_p;
			}

			if (Object.keys(inferenceConfig).length > 0) {
				requestBody.inferenceConfig = inferenceConfig;
			}

			// Handle response_format for AWS Bedrock via additionalModelRequestFields
			// This passes Anthropic-specific parameters through the Converse API
			if (
				response_format?.type === "json_schema" &&
				response_format.json_schema
			) {
				const schema = {
					...response_format.json_schema.schema,
					additionalProperties: false,
				} as Record<string, unknown>;
				requestBody.additionalModelRequestFields = {
					anthropic_beta: ["structured-outputs-2025-11-13"],
					output_format: {
						type: "json_schema",
						schema,
					},
				};
				requestBody.additionalModelResponseFieldPaths = ["/output_format"];
			}

			break;
		}
		case "google-ai-studio":
		case "google-vertex": {
			delete requestBody.model; // Not used in body
			delete requestBody.stream; // Stream is handled via URL parameter
			delete requestBody.messages; // Not used in body for Google providers
			delete requestBody.tool_choice; // Google doesn't support tool_choice parameter

			requestBody.contents = await transformGoogleMessages(
				processedMessages,
				isProd,
				maxImageSizeMB,
				userPlan,
			);

			// Transform tools from OpenAI format to Google format
			if (tools && tools.length > 0) {
				// Filter to only function tools (web_search is handled separately)
				const functionTools = tools.filter(isFunctionTool);
				if (functionTools.length > 0) {
					requestBody.tools = [
						{
							functionDeclarations: functionTools.map((tool) => {
								// Recursively strip additionalProperties and $schema from parameters as Google doesn't accept them
								const cleanParameters = stripUnsupportedSchemaProperties(
									tool.function.parameters || {},
								);
								return {
									name: tool.function.name,
									description: tool.function.description,
									parameters: cleanParameters,
								};
							}),
						},
					];
				}
			}

			// Add web search tool for Google (google_search grounding)
			if (webSearchTool) {
				if (!requestBody.tools) {
					requestBody.tools = [];
				}
				requestBody.tools.push({ google_search: {} });
			}

			requestBody.generationConfig = {};

			// Add optional parameters if they are provided
			if (temperature !== undefined) {
				requestBody.generationConfig.temperature = temperature;
			}
			if (max_tokens !== undefined) {
				requestBody.generationConfig.maxOutputTokens = max_tokens;
			}
			if (top_p !== undefined) {
				requestBody.generationConfig.topP = top_p;
			}

			// Handle JSON output mode for Google
			if (response_format?.type === "json_object") {
				requestBody.generationConfig.responseMimeType = "application/json";
			} else if (response_format?.type === "json_schema") {
				requestBody.generationConfig.responseMimeType = "application/json";
				// Convert OpenAI's JSON schema format to Google's format
				if (response_format.json_schema?.schema) {
					requestBody.generationConfig.responseSchema =
						convertOpenAISchemaToGoogle(response_format.json_schema.schema);
				}
			}

			// Enable thinking/reasoning content exposure for Google models that support reasoning
			if (supportsReasoning) {
				requestBody.generationConfig.thinkingConfig = {
					includeThoughts: true,
				};

				// Map reasoning_effort to thinking_budget
				if (reasoning_effort !== undefined) {
					const getThinkingBudget = (effort: string) => {
						switch (effort) {
							case "minimal":
								return 512; // Minimum supported by most models
							case "low":
								return 2048;
							case "high":
								return 24576; // Maximum for Flash models
							case "medium":
							default:
								return 8192; // Balanced default
						}
					};
					requestBody.generationConfig.thinkingConfig.thinkingBudget =
						getThinkingBudget(reasoning_effort);
				}
			}

			// Add image generation config if provided
			if (
				image_config?.aspect_ratio !== undefined ||
				image_config?.image_size !== undefined
			) {
				// Set responseModalities to enable image output
				requestBody.generationConfig.responseModalities = ["TEXT", "IMAGE"];
				requestBody.generationConfig.imageConfig = {};
				if (image_config.aspect_ratio !== undefined) {
					requestBody.generationConfig.imageConfig.aspectRatio =
						image_config.aspect_ratio;
				}
				if (image_config.image_size !== undefined) {
					requestBody.generationConfig.imageConfig.imageSize =
						image_config.image_size;
				}
			}

			// Set all safety settings to BLOCK_NONE to disable content filtering
			requestBody.safetySettings = [
				{ category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
				{ category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
				{
					category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
					threshold: "BLOCK_NONE",
				},
				{
					category: "HARM_CATEGORY_DANGEROUS_CONTENT",
					threshold: "BLOCK_NONE",
				},
			];

			break;
		}
		case "inference.net":
		case "together.ai": {
			if (usedModel.startsWith(`${usedProvider}/`)) {
				requestBody.model = usedModel.substring(usedProvider.length + 1);
			}

			// Add optional parameters if they are provided
			if (temperature !== undefined) {
				requestBody.temperature = temperature;
			}
			if (max_tokens !== undefined) {
				requestBody.max_tokens = max_tokens;
			}
			if (top_p !== undefined) {
				requestBody.top_p = top_p;
			}
			if (frequency_penalty !== undefined) {
				requestBody.frequency_penalty = frequency_penalty;
			}
			if (presence_penalty !== undefined) {
				requestBody.presence_penalty = presence_penalty;
			}
			break;
		}
		case "cerebras": {
			if (stream) {
				requestBody.stream_options = {
					include_usage: true,
				};
			}
			if (response_format) {
				// Cerebras requires strict: true for json_schema mode
				// and schema must be sanitized (no unsupported string fields)
				if (response_format.type === "json_schema") {
					requestBody.response_format = {
						...response_format,
						json_schema: {
							...response_format.json_schema,
							strict: true,
							schema: response_format.json_schema?.schema
								? sanitizeCerebrasSchema(response_format.json_schema.schema)
								: response_format.json_schema?.schema,
						},
					};
				} else {
					requestBody.response_format = response_format;
				}
			}

			// Cerebras requires strict: true inside each tool's function object
			// and additionalProperties: false on all object schemas
			if (requestBody.tools && Array.isArray(requestBody.tools)) {
				requestBody.tools = requestBody.tools.map((tool: any) => ({
					...tool,
					function: {
						...tool.function,
						strict: true,
						parameters: tool.function.parameters
							? sanitizeCerebrasSchema(tool.function.parameters)
							: tool.function.parameters,
					},
				}));
			}
			// Add optional parameters if they are provided
			if (temperature !== undefined) {
				requestBody.temperature = temperature;
			}
			if (max_tokens !== undefined) {
				requestBody.max_tokens = max_tokens;
			}
			if (top_p !== undefined) {
				requestBody.top_p = top_p;
			}
			if (frequency_penalty !== undefined) {
				requestBody.frequency_penalty = frequency_penalty;
			}
			if (presence_penalty !== undefined) {
				requestBody.presence_penalty = presence_penalty;
			}
			if (reasoning_effort !== undefined) {
				requestBody.reasoning_effort = reasoning_effort;
			}
			break;
		}
		case "perplexity": {
			if (stream) {
				requestBody.stream_options = {
					include_usage: true,
				};
			}
			// Perplexity supports json_schema but doesn't accept 'name' or 'strict' fields
			if (response_format) {
				if (
					response_format.type === "json_schema" &&
					response_format.json_schema
				) {
					requestBody.response_format = {
						type: "json_schema",
						json_schema: {
							schema: response_format.json_schema.schema,
						},
					};
				} else {
					requestBody.response_format = response_format;
				}
			}

			// Add optional parameters if they are provided
			if (temperature !== undefined) {
				requestBody.temperature = temperature;
			}
			if (max_tokens !== undefined) {
				requestBody.max_tokens = max_tokens;
			}
			if (top_p !== undefined) {
				requestBody.top_p = top_p;
			}
			if (frequency_penalty !== undefined) {
				requestBody.frequency_penalty = frequency_penalty;
			}
			if (presence_penalty !== undefined) {
				requestBody.presence_penalty = presence_penalty;
			}
			break;
		}
		default: {
			if (stream) {
				requestBody.stream_options = {
					include_usage: true,
				};
			}
			if (response_format) {
				requestBody.response_format = response_format;
			}

			// Add optional parameters if they are provided
			if (temperature !== undefined) {
				requestBody.temperature = temperature;
			}
			if (max_tokens !== undefined) {
				// GPT-5 models use max_completion_tokens instead of max_tokens
				if (usedModel.startsWith("gpt-5")) {
					requestBody.max_completion_tokens = max_tokens;
				} else {
					requestBody.max_tokens = max_tokens;
				}
			}
			if (top_p !== undefined) {
				requestBody.top_p = top_p;
			}
			if (frequency_penalty !== undefined) {
				requestBody.frequency_penalty = frequency_penalty;
			}
			if (presence_penalty !== undefined) {
				requestBody.presence_penalty = presence_penalty;
			}
			if (reasoning_effort !== undefined) {
				requestBody.reasoning_effort = reasoning_effort;
			}
			break;
		}
	}

	return requestBody;
}
