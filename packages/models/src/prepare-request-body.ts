import {
	type ModelDefinition,
	models,
	type ProviderModelMapping,
} from "./models.js";
import { transformAnthropicMessages } from "./transform-anthropic-messages.js";
import { transformGoogleMessages } from "./transform-google-messages.js";

import type { ProviderId } from "./providers.js";
import type {
	BaseMessage,
	FunctionParameter,
	OpenAIRequestBody,
	OpenAIResponsesRequestBody,
	OpenAIToolInput,
	ProviderRequestBody,
	ToolChoiceType,
} from "./types.js";

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
): Promise<ProviderRequestBody> {
	// Check if the model supports system role
	const modelDef = models.find((m) => m.id === usedModel);
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
	if (tools && tools.length > 0) {
		requestBody.tools = tools;
	}

	if (tool_choice) {
		requestBody.tool_choice = tool_choice;
	}

	// Override temperature to 1 for GPT-5 models (they only support temperature = 1)
	if (usedModel.startsWith("gpt-5")) {
		// eslint-disable-next-line no-param-reassign
		temperature = 1;
	}

	switch (usedProvider) {
		case "openai": {
			// Check if messages contain existing tool calls or tool results
			// If so, use Chat Completions API instead of Responses API
			const hasExistingToolCalls = messages.some(
				(msg: any) => msg.tool_calls || msg.role === "tool",
			);

			// Check if the model supports responses API (default to true if reasoning is enabled)
			const providerMapping = modelDef?.providers.find(
				(p) => p.providerId === "openai",
			);
			const supportsResponsesApi =
				process.env.USE_RESPONSES_API === "true" &&
				(providerMapping as ProviderModelMapping)?.supportsResponsesApi !==
					false;

			if (supportsReasoning && supportsResponsesApi && !hasExistingToolCalls) {
				// Transform to responses API format (only when no existing tool calls)
				const responsesBody: OpenAIResponsesRequestBody = {
					model: usedModel,
					input: processedMessages,
					reasoning: {
						effort: reasoning_effort || "medium",
						summary: "detailed",
					},
				};

				// Add streaming support
				if (stream) {
					responsesBody.stream = true;
				}

				// Add tools support for responses API (transform format if needed)
				if (tools && tools.length > 0) {
					// Transform tools from chat completions format to responses API format
					responsesBody.tools = tools.map((tool) => ({
						type: "function" as const,
						name: tool.function.name,
						description: tool.function.description,
						parameters: tool.function.parameters as FunctionParameter,
					}));
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
			break;
		}
		case "routeway-discount": {
			if (stream) {
				requestBody.stream_options = {
					include_usage: true,
				};
			}
			if (response_format) {
				// Override json_object to json for routeway-discount only for claude models
				if (
					response_format.type === "json_object" &&
					usedModel.startsWith("claude-")
				) {
					requestBody.response_format = {
						...response_format,
						type: "json",
					};
				} else {
					requestBody.response_format = response_format;
				}
			}

			// Add cache_control for claude models while keeping OpenAI format
			if (usedModel.startsWith("claude-")) {
				// Track cache_control usage to limit to maximum of 4 blocks
				let cacheControlCount = 0;
				const maxCacheControlBlocks = 4;

				requestBody.messages = processedMessages.map((message: any) => {
					if (Array.isArray(message.content)) {
						// Handle array content - add cache_control to long text blocks
						const updatedContent = message.content.map((part: any) => {
							if (part.type === "text" && part.text && !part.cache_control) {
								const shouldCache =
									part.text.length >= 1024 * 4 && // Rough token estimation
									cacheControlCount < maxCacheControlBlocks;
								if (shouldCache) {
									cacheControlCount++;
									return {
										...part,
										cache_control: { type: "ephemeral" },
									};
								}
							}
							return part;
						});
						return {
							...message,
							content: updatedContent,
						};
					} else if (typeof message.content === "string") {
						// Handle string content - add cache_control for long prompts
						const shouldCache =
							message.content.length >= 1024 * 4 && // Rough token estimation
							cacheControlCount < maxCacheControlBlocks;
						if (shouldCache) {
							cacheControlCount++;
							return {
								...message,
								content: [
									{
										type: "text",
										text: message.content,
										cache_control: { type: "ephemeral" },
									},
								],
							};
						}
					}
					return message;
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
			if (reasoning_effort !== undefined) {
				requestBody.reasoning_effort = reasoning_effort;
			}
			break;
		}
		case "xai":
		case "groq":
		case "deepseek":
		case "perplexity":
		case "novita":
		case "moonshot":
		case "alibaba":
		case "nebius":
		case "routeway":
		case "custom": {
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
			requestBody.messages = await transformAnthropicMessages(
				processedMessages.map((m) => ({
					...m, // Preserve original properties for transformation
					role:
						m.role === "assistant"
							? "assistant"
							: m.role === "system"
								? "user"
								: m.role === "tool"
									? "user" // Tool results become user messages in Anthropic
									: "user",
					content: m.content,
					tool_calls: m.tool_calls, // Include tool_calls for transformation
				})),
				isProd,
				usedProvider,
				usedModel,
			);

			// Transform tools from OpenAI format to Anthropic format
			if (tools && tools.length > 0) {
				requestBody.tools = tools.map((tool) => ({
					name: tool.function.name,
					description: tool.function.description,
					input_schema: tool.function.parameters,
				}));
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
			if (frequency_penalty !== undefined) {
				requestBody.frequency_penalty = frequency_penalty;
			}
			if (presence_penalty !== undefined) {
				requestBody.presence_penalty = presence_penalty;
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

			// Transform messages to Bedrock format
			requestBody.messages = processedMessages.map((msg: any) => {
				// Map OpenAI roles to Bedrock roles
				const role =
					msg.role === "system" || msg.role === "user" || msg.role === "tool"
						? "user"
						: "assistant";

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
				if (typeof msg.content === "string") {
					if (msg.content.trim()) {
						bedrockMessage.content.push({
							text: msg.content,
						});
					}
				} else if (Array.isArray(msg.content)) {
					// Handle multi-part content (text + images)
					msg.content.forEach((part: any) => {
						if (part.type === "text") {
							if (part.text && part.text.trim()) {
								bedrockMessage.content.push({
									text: part.text,
								});
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
				requestBody.toolConfig = {
					tools: tools.map((tool: any) => ({
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

			break;
		}
		case "google-ai-studio": {
			delete requestBody.model; // Not used in body
			delete requestBody.stream; // Stream is handled via URL parameter
			delete requestBody.messages; // Not used in body for Google providers
			delete requestBody.tool_choice; // Google doesn't support tool_choice parameter

			requestBody.contents = await transformGoogleMessages(
				processedMessages,
				isProd,
			);

			// Transform tools from OpenAI format to Google format
			if (tools && tools.length > 0) {
				requestBody.tools = [
					{
						functionDeclarations: tools.map((tool: any) => {
							// Remove additionalProperties and $schema from parameters as Google doesn't accept them
							const {
								additionalProperties: _additionalProperties,
								$schema: _$schema,
								...cleanParameters
							} = tool.function.parameters || {};
							return {
								name: tool.function.name,
								description: tool.function.description,
								parameters: cleanParameters,
							};
						}),
					},
				];
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
	}

	return requestBody;
}
