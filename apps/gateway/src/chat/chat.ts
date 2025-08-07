import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import {
	type ApiKey,
	db,
	type InferSelectModel,
	type Project,
	shortid,
	type tables,
} from "@llmgateway/db";
import {
	getCheapestFromAvailableProviders,
	getModelStreamingSupport,
	getProviderEndpoint,
	getProviderHeaders,
	type Model,
	models,
	prepareRequestBody,
	type Provider,
	providers,
} from "@llmgateway/models";
import { encode, encodeChat } from "gpt-tokenizer";
import { HTTPException } from "hono/http-exception";
import { streamSSE } from "hono/streaming";

import {
	checkCustomProviderExists,
	generateCacheKey,
	generateStreamingCacheKey,
	getCache,
	getCustomProviderKey,
	getOrganization,
	getProject,
	getProviderKey,
	getStreamingCache,
	isCachingEnabled,
	setCache,
	setStreamingCache,
} from "../lib/cache";
import { calculateCosts } from "../lib/costs";
import { insertLog } from "../lib/logs";
import {
	getProviderEnvVar,
	hasProviderEnvironmentToken,
} from "../lib/provider";

import type { ServerTypes } from "../vars";

// Define ChatMessage type to match what gpt-tokenizer expects
interface ChatMessage {
	role: "user" | "system" | "assistant" | undefined;
	content: string;
	name?: string;
}

const DEFAULT_TOKENIZER_MODEL = "gpt-4";

/**
 * Determines the appropriate finish reason based on HTTP status code and error message
 * 5xx status codes indicate upstream provider errors
 * 4xx status codes indicate client/gateway errors
 * Special client errors (like JSON format validation) are classified as client_error
 */
function getFinishReasonForError(
	statusCode: number,
	errorText?: string,
): string {
	if (statusCode >= 500) {
		return "upstream_error";
	}

	// Check for specific client validation errors from providers
	if (statusCode === 400 && errorText) {
		// OpenAI JSON format validation error
		if (
			errorText.includes("'messages' must contain") &&
			errorText.includes("the word 'json'")
		) {
			return "client_error";
		}
	}

	return "gateway_error";
}

/**
 * Validates and normalizes the x-source header
 * Strips http(s):// and www. if present
 * Validates allowed characters: a-zA-Z0-9, -, .
 */
function validateAndNormalizeSource(
	source: string | undefined,
): string | undefined {
	if (!source) {
		return undefined;
	}

	// Strip http:// or https:// if present
	let normalized = source.replace(/^https?:\/\//, "");

	// Strip www. if present
	normalized = normalized.replace(/^www\./, "");

	// Validate allowed characters: a-zA-Z0-9, -, .
	const allowedPattern = /^[a-zA-Z0-9.-]+$/;
	if (!allowedPattern.test(normalized)) {
		throw new HTTPException(400, {
			message:
				"Invalid x-source header: only alphanumeric characters, hyphens, and dots are allowed",
		});
	}

	return normalized;
}

/**
 * Creates a partial log entry with common fields to reduce duplication
 */
function createLogEntry(
	requestId: string,
	project: Project,
	apiKey: ApiKey,
	providerKeyId: string | undefined,
	usedModel: string,
	usedProvider: string,
	requestedModel: string,
	requestedProvider: string | undefined,
	messages: any[],
	temperature: number | undefined,
	max_tokens: number | undefined,
	top_p: number | undefined,
	frequency_penalty: number | undefined,
	presence_penalty: number | undefined,
	tools: any[] | undefined,
	toolChoice: any | undefined,
	source: string | undefined,
) {
	return {
		requestId,
		organizationId: project.organizationId,
		projectId: apiKey.projectId,
		apiKeyId: apiKey.id,
		usedMode: providerKeyId ? "api-keys" : "credits",
		usedModel,
		usedProvider,
		requestedModel,
		requestedProvider,
		messages,
		temperature: temperature || null,
		maxTokens: max_tokens || null,
		topP: top_p || null,
		frequencyPenalty: frequency_penalty || null,
		presencePenalty: presence_penalty || null,
		tools: tools || null,
		toolChoice: toolChoice || null,
		mode: project.mode,
		source: source || null,
	} as const;
}

/**
 * Get provider token from environment variables
 * @param usedProvider The provider to get the token for
 * @returns The token for the provider or undefined if not found
 */
function getProviderTokenFromEnv(usedProvider: Provider): string | undefined {
	const envVar = getProviderEnvVar(usedProvider);
	if (!envVar) {
		throw new HTTPException(400, {
			message: `No environment variable set for provider: ${usedProvider}`,
		});
	}
	const token = process.env[envVar];
	if (!token) {
		throw new HTTPException(400, {
			message: `No API key set in environment for provider: ${usedProvider}`,
		});
	}
	return token;
}

/**
 * Parses response content and metadata from different providers
 */
function parseProviderResponse(usedProvider: Provider, json: any) {
	let content = null;
	let reasoningContent = null;
	let finishReason = null;
	let promptTokens = null;
	let completionTokens = null;
	let totalTokens = null;
	let reasoningTokens = null;
	let cachedTokens = null;
	let toolResults = null;

	switch (usedProvider) {
		case "anthropic":
			content = json.content?.[0]?.text || null;
			finishReason = json.stop_reason || null;
			promptTokens = json.usage?.input_tokens || null;
			completionTokens = json.usage?.output_tokens || null;
			reasoningTokens = json.usage?.reasoning_output_tokens || null;
			cachedTokens = json.usage?.cache_read_input_tokens || null;
			totalTokens =
				json.usage?.input_tokens && json.usage?.output_tokens
					? json.usage.input_tokens + json.usage.output_tokens
					: null;
			// Extract tool calls from Anthropic format
			toolResults =
				json.content
					?.filter((block: any) => block.type === "tool_use")
					?.map((block: any) => ({
						id: block.id,
						type: "function",
						function: {
							name: block.name,
							arguments: JSON.stringify(block.input),
						},
					})) || null;
			if (toolResults && toolResults.length === 0) {
				toolResults = null;
			}
			break;
		case "google-vertex":
		case "google-ai-studio": {
			// Extract content and reasoning content from Google response parts
			const parts = json.candidates?.[0]?.content?.parts || [];
			const contentParts = parts.filter((part: any) => !part.thought);
			const reasoningParts = parts.filter((part: any) => part.thought);

			content = contentParts.map((part: any) => part.text).join("") || null;
			reasoningContent =
				reasoningParts.map((part: any) => part.text).join("") || null;

			finishReason = json.candidates?.[0]?.finishReason || null;
			promptTokens = json.usageMetadata?.promptTokenCount || null;
			completionTokens = json.usageMetadata?.candidatesTokenCount || null;
			reasoningTokens = json.usageMetadata?.thoughtsTokenCount || null;
			// Don't use Google's totalTokenCount as it doesn't include reasoning tokens
			totalTokens = null;

			// If candidatesTokenCount is missing, estimate it from the content or set to 0
			if (completionTokens === null) {
				if (content) {
					const estimation = estimateTokens(
						usedProvider,
						[],
						content,
						null,
						null,
					);
					completionTokens = estimation.calculatedCompletionTokens;
				} else {
					// No content means 0 completion tokens (e.g., MAX_TOKENS with only reasoning)
					completionTokens = 0;
				}
			}

			// Calculate totalTokens to include reasoning tokens for Google models
			if (promptTokens !== null) {
				totalTokens =
					promptTokens + (completionTokens || 0) + (reasoningTokens || 0);
			}

			// Extract tool calls from Google format - reuse the same parts array
			toolResults =
				parts
					.filter((part: any) => part.functionCall)
					.map((part: any) => ({
						id: part.functionCall.name + "_" + Date.now(), // Google doesn't provide ID, so generate one
						type: "function",
						function: {
							name: part.functionCall.name,
							arguments: JSON.stringify(part.functionCall.args || {}),
						},
					})) || null;
			if (toolResults && toolResults.length === 0) {
				toolResults = null;
			}
			break;
		}
		case "mistral":
			content = json.choices?.[0]?.message?.content || null;
			finishReason = json.choices?.[0]?.finish_reason || null;
			promptTokens = json.usage?.prompt_tokens || null;
			completionTokens = json.usage?.completion_tokens || null;
			reasoningTokens = json.usage?.reasoning_tokens || null;
			totalTokens = json.usage?.total_tokens || null;

			// Handle Mistral's JSON output mode which wraps JSON in markdown code blocks
			if (
				content &&
				typeof content === "string" &&
				content.includes("```json")
			) {
				const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
				if (jsonMatch && jsonMatch[1]) {
					// Extract and clean the JSON content
					content = jsonMatch[1].trim();
					// Ensure it's valid JSON by parsing and re-stringifying to normalize formatting
					try {
						const parsed = JSON.parse(content);
						content = JSON.stringify(parsed);
					} catch (_e) {}
				}
			}

			// Extract tool calls from Mistral format (same as OpenAI)
			toolResults = json.choices?.[0]?.message?.tool_calls || null;
			break;
		default: // OpenAI format
			toolResults = json.choices?.[0]?.message?.tool_calls || null;
			content = json.choices?.[0]?.message?.content || null;
			// Extract reasoning content for reasoning-capable models
			reasoningContent = json.choices?.[0]?.message?.reasoning_content || null;
			finishReason = json.choices?.[0]?.finish_reason || null;
			promptTokens = json.usage?.prompt_tokens || null;
			completionTokens = json.usage?.completion_tokens || null;
			reasoningTokens = json.usage?.reasoning_tokens || null;
			cachedTokens = json.usage?.prompt_tokens_details?.cached_tokens || null;
			totalTokens =
				json.usage?.total_tokens ||
				(promptTokens !== null && completionTokens !== null
					? promptTokens + completionTokens + (reasoningTokens || 0)
					: null);
			break;
	}

	return {
		content,
		reasoningContent,
		finishReason,
		promptTokens,
		completionTokens,
		totalTokens,
		reasoningTokens,
		cachedTokens,
		toolResults,
	};
}

/**
 * Estimates token counts when not provided by the API using gpt-tokenizer
 */
function estimateTokens(
	usedProvider: Provider,
	messages: any[],
	content: string | null,
	promptTokens: number | null,
	completionTokens: number | null,
) {
	let calculatedPromptTokens = promptTokens;
	let calculatedCompletionTokens = completionTokens;

	// Always estimate missing tokens for any provider
	if (!promptTokens || !completionTokens) {
		// Estimate prompt tokens using encodeChat for better accuracy
		if (!promptTokens && messages && messages.length > 0) {
			try {
				// Convert messages to the format expected by gpt-tokenizer
				const chatMessages: ChatMessage[] = messages.map((m) => ({
					role: m.role,
					content:
						typeof m.content === "string"
							? m.content
							: JSON.stringify(m.content),
					name: m.name,
				}));
				calculatedPromptTokens = encodeChat(
					chatMessages,
					DEFAULT_TOKENIZER_MODEL,
				).length;
			} catch (error) {
				// Fallback to simple estimation if encoding fails
				console.error(
					`Failed to encode chat messages in estimate tokens: ${error}`,
				);
				calculatedPromptTokens =
					messages.reduce((acc, m) => acc + (m.content?.length || 0), 0) / 4;
			}
		}

		// Estimate completion tokens using encode for better accuracy
		if (!completionTokens && content) {
			try {
				calculatedCompletionTokens = encode(content).length;
			} catch (error) {
				// Fallback to simple estimation if encoding fails
				console.error(`Failed to encode completion text: ${error}`);
				calculatedCompletionTokens = content.length / 4;
			}
		}
	}

	return {
		calculatedPromptTokens,
		calculatedCompletionTokens,
	};
}

/**
 * Estimates tokens from content length using simple division
 */
function estimateTokensFromContent(content: string): number {
	return Math.max(1, Math.round(content.length / 4));
}

/**
 * Extracts content from streaming data based on provider format
 */
function extractContentFromProvider(data: any, provider: Provider): string {
	switch (provider) {
		case "google-vertex":
		case "google-ai-studio": {
			const parts = data.candidates?.[0]?.content?.parts || [];
			const contentParts = parts.filter((part: any) => !part.thought);
			return contentParts.map((part: any) => part.text).join("") || "";
		}
		case "anthropic":
			if (data.type === "content_block_delta" && data.delta?.text) {
				return data.delta.text;
			} else if (data.delta?.text) {
				return data.delta.text;
			}
			return "";
		default: // OpenAI format
			return data.choices?.[0]?.delta?.content || "";
	}
}

/**
 * Extracts reasoning content from streaming data based on provider format
 */
function extractReasoningContentFromProvider(
	data: any,
	provider: Provider,
): string {
	switch (provider) {
		case "google-vertex":
		case "google-ai-studio": {
			const parts = data.candidates?.[0]?.content?.parts || [];
			const reasoningParts = parts.filter((part: any) => part.thought);
			return reasoningParts.map((part: any) => part.text).join("") || "";
		}
		default: // OpenAI format
			return data.choices?.[0]?.delta?.reasoning_content || "";
	}
}

/**
 * Extracts tool calls from streaming data based on provider format
 */
function extractToolCallsFromProvider(
	data: any,
	provider: Provider,
): any[] | null {
	switch (provider) {
		case "anthropic":
			// Anthropic streaming tool calls come as content_block_start with tool_use type
			if (
				data.type === "content_block_start" &&
				data.content_block?.type === "tool_use"
			) {
				return [
					{
						id: data.content_block.id,
						type: "function",
						function: {
							name: data.content_block.name,
							arguments: "",
						},
					},
				];
			}
			// Tool arguments come as content_block_delta
			if (data.type === "content_block_delta" && data.delta?.partial_json) {
				return [
					{
						id: data.index ? `tool_${data.index}` : "tool_unknown",
						type: "function",
						function: {
							name: "",
							arguments: data.delta.partial_json,
						},
					},
				];
			}
			return null;
		case "google-vertex":
		case "google-ai-studio": {
			// Google Vertex AI tool calls in streaming
			const parts = data.candidates?.[0]?.content?.parts || [];
			return (
				parts
					.filter((part: any) => part.functionCall)
					.map((part: any) => ({
						id: part.functionCall.name + "_" + Date.now(),
						type: "function",
						function: {
							name: part.functionCall.name,
							arguments: JSON.stringify(part.functionCall.args || {}),
						},
					})) || null
			);
		}
		default: // OpenAI format
			return data.choices?.[0]?.delta?.tool_calls || null;
	}
}

/**
 * Extracts token usage information from streaming data based on provider format
 */
function extractTokenUsage(
	data: any,
	provider: Provider,
	fullContent?: string,
) {
	let promptTokens = null;
	let completionTokens = null;
	let totalTokens = null;
	let reasoningTokens = null;
	let cachedTokens = null;

	switch (provider) {
		case "google-vertex":
		case "google-ai-studio":
			if (data.usageMetadata) {
				promptTokens = data.usageMetadata.promptTokenCount || null;
				completionTokens = data.usageMetadata.candidatesTokenCount || null;
				// Don't use Google's totalTokenCount as it doesn't include reasoning tokens
				reasoningTokens = data.usageMetadata.thoughtsTokenCount || null;
				// Calculate total including reasoning tokens
				totalTokens =
					(promptTokens || 0) +
					(completionTokens || 0) +
					(reasoningTokens || 0);

				// If candidatesTokenCount is missing and we have content, estimate it
				if (completionTokens === null && fullContent) {
					const estimation = estimateTokens(
						provider,
						[],
						fullContent,
						null,
						null,
					);
					completionTokens = estimation.calculatedCompletionTokens;
				}
			}
			break;
		case "anthropic":
			if (data.usage) {
				promptTokens = data.usage.input_tokens || null;
				completionTokens = data.usage.output_tokens || null;
				reasoningTokens = data.usage.reasoning_output_tokens || null;
				cachedTokens = data.usage.cache_read_input_tokens || null;
				totalTokens = (promptTokens || 0) + (completionTokens || 0);
			}
			break;
		default: // OpenAI format
			if (data.usage) {
				promptTokens = data.usage.prompt_tokens || null;
				completionTokens = data.usage.completion_tokens || null;
				totalTokens = data.usage.total_tokens || null;
				reasoningTokens = data.usage.reasoning_tokens || null;
				cachedTokens = data.usage.prompt_tokens_details?.cached_tokens || null;
			}
			break;
	}

	return {
		promptTokens,
		completionTokens,
		totalTokens,
		reasoningTokens,
		cachedTokens,
	};
}

/**
 * Transforms response to OpenAI format for non-OpenAI providers
 */
function transformToOpenAIFormat(
	usedProvider: Provider,
	usedModel: string,
	json: any,
	content: string | null,
	reasoningContent: string | null,
	finishReason: string | null,
	promptTokens: number | null,
	completionTokens: number | null,
	totalTokens: number | null,
	reasoningTokens: number | null,
	cachedTokens: number | null,
	toolResults: any,
) {
	let transformedResponse = json;

	switch (usedProvider) {
		case "google-vertex":
		case "google-ai-studio": {
			transformedResponse = {
				id: `chatcmpl-${Date.now()}`,
				object: "chat.completion",
				created: Math.floor(Date.now() / 1000),
				model: usedModel,
				choices: [
					{
						index: 0,
						message: {
							role: "assistant",
							content: content,
							...(reasoningContent !== null && {
								reasoning_content: reasoningContent,
							}),
							...(toolResults && { tool_calls: toolResults }),
						},
						finish_reason:
							finishReason === "STOP"
								? toolResults && toolResults.length > 0
									? "tool_calls"
									: "stop"
								: finishReason?.toLowerCase() || "stop",
					},
				],
				usage: {
					prompt_tokens: promptTokens,
					completion_tokens: completionTokens,
					total_tokens: totalTokens,
					...(reasoningTokens !== null && {
						reasoning_tokens: reasoningTokens,
					}),
					...(cachedTokens !== null && {
						prompt_tokens_details: {
							cached_tokens: cachedTokens,
						},
					}),
				},
			};
			break;
		}
		case "anthropic": {
			transformedResponse = {
				id: `chatcmpl-${Date.now()}`,
				object: "chat.completion",
				created: Math.floor(Date.now() / 1000),
				model: usedModel,
				choices: [
					{
						index: 0,
						message: {
							role: "assistant",
							content: content,
							...(reasoningContent !== null && {
								reasoning_content: reasoningContent,
							}),
							...(toolResults && { tool_calls: toolResults }),
						},
						finish_reason:
							finishReason === "end_turn"
								? "stop"
								: finishReason === "tool_use"
									? "tool_calls"
									: finishReason?.toLowerCase() || "stop",
					},
				],
				usage: {
					prompt_tokens: promptTokens,
					completion_tokens: completionTokens,
					total_tokens: totalTokens,
					...(reasoningTokens !== null && {
						reasoning_tokens: reasoningTokens,
					}),
					...(cachedTokens !== null && {
						prompt_tokens_details: {
							cached_tokens: cachedTokens,
						},
					}),
				},
			};
			break;
		}
		case "inference.net":
		case "together.ai":
		case "groq": {
			if (!transformedResponse.id) {
				transformedResponse = {
					id: `chatcmpl-${Date.now()}`,
					object: "chat.completion",
					created: Math.floor(Date.now() / 1000),
					model: usedModel,
					choices: [
						{
							index: 0,
							message: {
								role: "assistant",
								content: content,
								...(reasoningContent !== null && {
									reasoning_content: reasoningContent,
								}),
							},
							finish_reason: finishReason || "stop",
						},
					],
					usage: {
						prompt_tokens: promptTokens,
						completion_tokens: completionTokens,
						total_tokens: totalTokens,
						...(reasoningTokens !== null && {
							reasoning_tokens: reasoningTokens,
						}),
					},
				};
			}
			break;
		}
	}

	return transformedResponse;
}

/**
 * Transforms streaming chunk to OpenAI format for non-OpenAI providers
 */
function transformStreamingChunkToOpenAIFormat(
	usedProvider: Provider,
	usedModel: string,
	data: any,
): any {
	let transformedData = data;

	switch (usedProvider) {
		case "anthropic": {
			// Handle different types of Anthropic streaming events
			if (data.type === "content_block_delta" && data.delta?.text) {
				transformedData = {
					id: data.id || `chatcmpl-${Date.now()}`,
					object: "chat.completion.chunk",
					created: data.created || Math.floor(Date.now() / 1000),
					model: data.model || usedModel,
					choices: [
						{
							index: 0,
							delta: {
								content: data.delta.text,
								role: "assistant",
							},
							finish_reason: null,
						},
					],
					usage: data.usage || null,
				};
			} else if (
				data.type === "content_block_start" &&
				data.content_block?.type === "tool_use"
			) {
				// Handle tool call start
				transformedData = {
					id: data.id || `chatcmpl-${Date.now()}`,
					object: "chat.completion.chunk",
					created: data.created || Math.floor(Date.now() / 1000),
					model: data.model || usedModel,
					choices: [
						{
							index: 0,
							delta: {
								tool_calls: [
									{
										index: data.index || 0,
										id: data.content_block.id,
										type: "function",
										function: {
											name: data.content_block.name,
											arguments: "",
										},
									},
								],
								role: "assistant",
							},
							finish_reason: null,
						},
					],
					usage: data.usage || null,
				};
			} else if (
				data.type === "content_block_delta" &&
				data.delta?.partial_json
			) {
				// Handle tool call arguments delta
				transformedData = {
					id: data.id || `chatcmpl-${Date.now()}`,
					object: "chat.completion.chunk",
					created: data.created || Math.floor(Date.now() / 1000),
					model: data.model || usedModel,
					choices: [
						{
							index: 0,
							delta: {
								tool_calls: [
									{
										index: data.index || 0,
										function: {
											arguments: data.delta.partial_json,
										},
									},
								],
								role: "assistant",
							},
							finish_reason: null,
						},
					],
					usage: data.usage || null,
				};
			} else if (data.type === "message_delta" && data.delta?.stop_reason) {
				const stopReason = data.delta.stop_reason;
				transformedData = {
					id: data.id || `chatcmpl-${Date.now()}`,
					object: "chat.completion.chunk",
					created: data.created || Math.floor(Date.now() / 1000),
					model: data.model || usedModel,
					choices: [
						{
							index: 0,
							delta: {
								role: "assistant",
							},
							finish_reason:
								stopReason === "end_turn"
									? "stop"
									: stopReason === "tool_use"
										? "tool_calls"
										: stopReason?.toLowerCase() || "stop",
						},
					],
					usage: data.usage || null,
				};
			} else if (data.type === "message_stop" || data.stop_reason) {
				const stopReason = data.stop_reason || "end_turn";
				transformedData = {
					id: data.id || `chatcmpl-${Date.now()}`,
					object: "chat.completion.chunk",
					created: data.created || Math.floor(Date.now() / 1000),
					model: data.model || usedModel,
					choices: [
						{
							index: 0,
							delta: {
								role: "assistant",
							},
							finish_reason:
								stopReason === "end_turn"
									? "stop"
									: stopReason === "tool_use"
										? "tool_calls"
										: stopReason?.toLowerCase() || "stop",
						},
					],
					usage: data.usage || null,
				};
			} else if (data.delta?.text) {
				// Fallback for older format
				transformedData = {
					id: data.id || `chatcmpl-${Date.now()}`,
					object: "chat.completion.chunk",
					created: data.created || Math.floor(Date.now() / 1000),
					model: data.model || usedModel,
					choices: [
						{
							index: 0,
							delta: {
								content: data.delta.text,
								role: "assistant",
							},
							finish_reason: null,
						},
					],
					usage: data.usage || null,
				};
			} else {
				// For other Anthropic events (like message_start, content_block_start, etc.)
				// Transform them to OpenAI format but without content
				transformedData = {
					id: data.id || `chatcmpl-${Date.now()}`,
					object: "chat.completion.chunk",
					created: data.created || Math.floor(Date.now() / 1000),
					model: data.model || usedModel,
					choices: [
						{
							index: 0,
							delta: {
								role: "assistant",
							},
							finish_reason: null,
						},
					],
					usage: data.usage || null,
				};
			}
			break;
		}
		case "google-vertex":
		case "google-ai-studio": {
			if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
				transformedData = {
					id: data.responseId || `chatcmpl-${Date.now()}`,
					object: "chat.completion.chunk",
					created: Math.floor(Date.now() / 1000),
					model: data.modelVersion || usedModel,
					choices: [
						{
							index: data.candidates[0].index || 0,
							delta: {
								content: data.candidates[0].content.parts[0].text,
								role: "assistant",
							},
							finish_reason: null,
						},
					],
					usage: data.usageMetadata
						? {
								prompt_tokens: data.usageMetadata.promptTokenCount || 0,
								completion_tokens: data.usageMetadata.candidatesTokenCount || 0,
								// Calculate total including reasoning tokens for Google models
								total_tokens:
									(data.usageMetadata.promptTokenCount || 0) +
									(data.usageMetadata.candidatesTokenCount || 0) +
									(data.usageMetadata.thoughtsTokenCount || 0),
								...(data.usageMetadata.thoughtsTokenCount && {
									reasoning_tokens: data.usageMetadata.thoughtsTokenCount,
								}),
							}
						: null,
				};
			} else if (data.candidates?.[0]?.finishReason) {
				const finishReason = data.candidates[0].finishReason;
				// Check if there are function calls in this response
				const hasFunctionCalls = data.candidates?.[0]?.content?.parts?.some(
					(part: any) => part.functionCall,
				);
				transformedData = {
					id: data.responseId || `chatcmpl-${Date.now()}`,
					object: "chat.completion.chunk",
					created: Math.floor(Date.now() / 1000),
					model: data.modelVersion || usedModel,
					choices: [
						{
							index: data.candidates[0].index || 0,
							delta: {
								role: "assistant",
							},
							finish_reason:
								finishReason === "STOP"
									? hasFunctionCalls
										? "tool_calls"
										: "stop"
									: finishReason?.toLowerCase() || "stop",
						},
					],
					usage: data.usageMetadata
						? {
								prompt_tokens: data.usageMetadata.promptTokenCount || 0,
								completion_tokens: data.usageMetadata.candidatesTokenCount || 0,
								// Calculate total including reasoning tokens for Google models
								total_tokens:
									(data.usageMetadata.promptTokenCount || 0) +
									(data.usageMetadata.candidatesTokenCount || 0) +
									(data.usageMetadata.thoughtsTokenCount || 0),
								...(data.usageMetadata.thoughtsTokenCount && {
									reasoning_tokens: data.usageMetadata.thoughtsTokenCount,
								}),
							}
						: null,
				};
			}
			break;
		}
		// OpenAI and other providers that already use OpenAI format
		default: {
			// Ensure the response has the required OpenAI format fields
			if (!data.id || !data.object) {
				transformedData = {
					id: data.id || `chatcmpl-${Date.now()}`,
					object: "chat.completion.chunk",
					created: data.created || Math.floor(Date.now() / 1000),
					model: data.model || usedModel,
					choices: data.choices || [
						{
							index: 0,
							delta: data.delta
								? {
										...data.delta,
										role: "assistant",
									}
								: {
										content: data.content || "",
										tool_calls: data.tool_calls || null,
										role: "assistant",
									},
							finish_reason: data.finish_reason || null,
						},
					],
					usage: data.usage || null,
				};
			} else {
				// Even if the response has the correct format, ensure role is set in delta and object is correct for streaming
				transformedData = {
					...data,
					object: "chat.completion.chunk", // Force correct object type for streaming
					choices:
						data.choices?.map((choice: any) => ({
							...choice,
							delta: choice.delta
								? {
										...choice.delta,
										role: choice.delta.role || "assistant",
									}
								: choice.delta,
						})) || data.choices,
				};
			}
			break;
		}
	}

	return transformedData;
}

export const chat = new OpenAPIHono<ServerTypes>();

const completionsRequestSchema = z.object({
	model: z.string().openapi({
		example: "gpt-4o",
	}),
	messages: z.array(
		z.object({
			role: z.string().openapi({
				example: "user",
			}),
			content: z.union([
				z.string().openapi({
					example: "Hello!",
				}),
				z.array(
					z.union([
						z.object({
							type: z.literal("text"),
							text: z.string(),
						}),
						z.object({
							type: z.literal("image_url"),
							image_url: z.object({
								url: z.string(),
								detail: z.enum(["low", "high", "auto"]).optional(),
							}),
						}),
					]),
				),
			]),
			name: z.string().optional(),
			tool_call_id: z.string().optional(),
			tool_calls: z
				.array(
					z.object({
						id: z.string(),
						type: z.literal("function"),
						function: z.object({
							name: z.string(),
							arguments: z.string(),
						}),
					}),
				)
				.optional()
				.openapi({
					description:
						"A list of tool calls generated by the model in this message.",
					example: [
						{
							id: "call_abc123",
							type: "function",
							function: {
								name: "get_current_weather",
								arguments: '{"location": "Boston, MA"}',
							},
						},
					],
				}),
		}),
	),
	temperature: z.number().optional(),
	max_tokens: z.number().optional(),
	top_p: z.number().optional(),
	frequency_penalty: z.number().optional(),
	presence_penalty: z.number().optional(),
	response_format: z
		.object({
			type: z.enum(["text", "json_object"]).openapi({
				example: "json_object",
			}),
		})
		.optional(),
	stream: z.boolean().optional().default(false),
	tools: z
		.array(
			z.object({
				type: z.literal("function"),
				function: z.object({
					name: z.string(),
					description: z.string().optional(),
					parameters: z.record(z.any()).optional(),
				}),
			}),
		)
		.optional(),
	tool_choice: z
		.union([
			z.literal("auto"),
			z.literal("none"),
			z.object({
				type: z.literal("function"),
				function: z.object({
					name: z.string(),
				}),
			}),
		])
		.optional(),
	reasoning_effort: z.enum(["low", "medium", "high"]).optional().openapi({
		description: "Controls the reasoning effort for reasoning-capable models",
		example: "medium",
	}),
});

const completions = createRoute({
	operationId: "v1_chat_completions",
	summary: "Chat Completions",
	description: "Create a completion for the chat conversation",
	method: "post",
	path: "/completions",
	request: {
		body: {
			content: {
				"application/json": {
					schema: completionsRequestSchema,
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						id: z.string(),
						object: z.string(),
						created: z.number(),
						model: z.string(),
						choices: z.array(
							z.object({
								index: z.number(),
								message: z.object({
									role: z.string(),
									content: z.string().nullable(),
									reasoning_content: z.string().nullable().optional(),
									tool_calls: z
										.array(
											z.object({
												id: z.string(),
												type: z.literal("function"),
												function: z.object({
													name: z.string(),
													arguments: z.string(),
												}),
											}),
										)
										.optional(),
								}),
								finish_reason: z.string(),
							}),
						),
						usage: z.object({
							prompt_tokens: z.number(),
							completion_tokens: z.number(),
							total_tokens: z.number(),
							reasoning_tokens: z.number().optional(),
							prompt_tokens_details: z
								.object({
									cached_tokens: z.number().optional(),
								})
								.optional(),
						}),
					}),
				},
				"text/event-stream": {
					schema: z.any(),
				},
			},
			description: "User response object or streaming response.",
		},
		500: {
			content: {
				"application/json": {
					schema: z.object({
						error: z.object({
							message: z.string(),
							type: z.string(),
							param: z.string().nullable(),
							code: z.string(),
						}),
					}),
				},
				"text/event-stream": {
					schema: z.any(),
				},
			},
			description: "Error response object.",
		},
	},
});

chat.openapi(completions, async (c) => {
	// Extract or generate request ID
	const requestId = c.req.header("x-request-id") || shortid(40);

	// Parse JSON manually even if it's malformed
	let rawBody: unknown;
	try {
		rawBody = await c.req.json();
	} catch (_error) {
		return c.json(
			{
				error: {
					message: "Invalid JSON in request body",
					type: "invalid_request_error",
					param: null,
					code: "invalid_json",
				},
			},
			400,
		);
	}

	// Validate against schema
	const validationResult = completionsRequestSchema.safeParse(rawBody);
	if (!validationResult.success) {
		return c.json(
			{
				error: {
					message: "Invalid request parameters",
					type: "invalid_request_error",
					param: null,
					code: "invalid_parameters",
				},
			},
			400,
		);
	}

	const {
		model: modelInput,
		messages,
		temperature,
		max_tokens,
		top_p,
		frequency_penalty,
		presence_penalty,
		response_format,
		stream,
		tools,
		tool_choice,
		reasoning_effort,
	} = validationResult.data;

	// Extract and validate source from x-source header
	const source = validateAndNormalizeSource(c.req.header("x-source"));

	c.header("x-request-id", requestId);

	let requestedModel: Model = modelInput as Model;
	let requestedProvider: Provider | undefined;
	let customProviderName: string | undefined;

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
		const modelName = split.slice(1).join("/");

		// For custom providers, we don't need to validate the model name
		// since they can use any OpenAI-compatible model name
		if (requestedProvider === "custom") {
			requestedModel = modelName as Model;
		} else {
			// First try to find by base model name
			let modelDef = models.find((m) => m.id === modelName);

			if (!modelDef) {
				modelDef = models.find((m) =>
					m.providers.some(
						(p) =>
							p.modelName === modelName && p.providerId === requestedProvider,
					),
				);
			}

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

			// Use the provider-specific model name if available
			const providerMapping = modelDef.providers.find(
				(p) => p.providerId === requestedProvider,
			);
			if (providerMapping) {
				requestedModel = providerMapping.modelName as Model;
			} else {
				requestedModel = modelName as Model;
			}
		}
	} else if (models.find((m) => m.id === modelInput)) {
		requestedModel = modelInput as Model;
	} else if (
		models.find((m) => m.providers.find((p) => p.modelName === modelInput))
	) {
		const model = models.find((m) =>
			m.providers.find((p) => p.modelName === modelInput),
		);
		const provider = model?.providers.find((p) => p.modelName === modelInput);

		throw new HTTPException(400, {
			message: `Model ${modelInput} must be requested with a provider prefix. Use the format: ${provider?.providerId}/${model?.id}`,
		});
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

	let modelInfo;

	if (requestedProvider === "custom") {
		// For custom providers, we create a mock model info that treats it as an OpenAI model
		modelInfo = {
			model: requestedModel,
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
				},
			],
			jsonOutput: true,
		};
	} else {
		modelInfo =
			models.find((m) => m.id === requestedModel) ||
			models.find((m) =>
				m.providers.find((p) => p.modelName === requestedModel),
			);

		if (!modelInfo) {
			throw new HTTPException(400, {
				message: `Unsupported model: ${requestedModel}`,
			});
		}
	}

	// Check if model is deactivated
	if (modelInfo.deactivatedAt && new Date() > modelInfo.deactivatedAt) {
		throw new HTTPException(410, {
			message: `Model ${requestedModel} has been deactivated and is no longer available`,
		});
	}

	if (response_format?.type === "json_object") {
		if (!(modelInfo as any).jsonOutput) {
			throw new HTTPException(400, {
				message: `Model ${requestedModel} does not support JSON output mode`,
			});
		}
	}

	// Check if reasoning_effort is specified but model doesn't support reasoning
	if (reasoning_effort !== undefined) {
		// Check if any provider for this model supports reasoning
		const supportsReasoning = modelInfo.providers.some(
			(provider) => (provider as any).reasoning === true,
		);

		if (!supportsReasoning) {
			console.error(
				`Reasoning effort specified for non-reasoning model: ${requestedModel}`,
				{
					requestedModel,
					requestedProvider,
					reasoning_effort,
					modelProviders: modelInfo.providers.map((p) => ({
						providerId: p.providerId,
						reasoning: (p as any).reasoning,
					})),
				},
			);

			throw new HTTPException(400, {
				message: `Model ${requestedModel} does not support reasoning. Remove the reasoning_effort parameter or use a reasoning-capable model.`,
			});
		}
	}

	let usedProvider = requestedProvider;
	let usedModel = requestedModel;

	const auth = c.req.header("Authorization");
	if (!auth) {
		throw new HTTPException(401, {
			message:
				"Unauthorized: No Authorization header provided. Expected 'Bearer your-api-token'",
		});
	}

	const split = auth.split("Bearer ");
	if (split.length !== 2) {
		throw new HTTPException(401, {
			message:
				"Unauthorized: Invalid Authorization header format. Expected 'Bearer your-api-token'",
		});
	}
	const token = split[1];
	if (!token) {
		throw new HTTPException(401, {
			message: "Unauthorized: No token provided",
		});
	}

	const apiKey = await db.query.apiKey.findFirst({
		where: {
			token: {
				eq: token,
			},
		},
	});

	if (!apiKey || apiKey.status !== "active") {
		throw new HTTPException(401, {
			message:
				"Unauthorized: Invalid LLMGateway API token. Please make sure the token is not deleted or disabled. Go to the LLMGateway 'API Keys' page to generate a new token.",
		});
	}

	if (apiKey.usageLimit && Number(apiKey.usage) >= Number(apiKey.usageLimit)) {
		throw new HTTPException(401, {
			message: "Unauthorized: LLMGateway API key reached its usage limit.",
		});
	}

	// Get the project to determine mode for routing decisions
	const project = await getProject(apiKey.projectId);

	if (!project) {
		throw new HTTPException(500, {
			message: "Could not find project",
		});
	}

	// Validate the custom provider against the database if one was requested
	if (requestedProvider === "custom" && customProviderName) {
		const customProviderExists = await checkCustomProviderExists(
			project.organizationId,
			customProviderName,
		);
		if (!customProviderExists) {
			throw new HTTPException(400, {
				message: `Provider '${customProviderName}' not found.`,
			});
		}
	}

	// Apply routing logic after apiKey and project are available
	if (
		(usedProvider === "llmgateway" && usedModel === "auto") ||
		usedModel === "auto"
	) {
		// Get available providers based on project mode
		let availableProviders: string[] = [];

		if (project.mode === "api-keys") {
			const providerKeys = await db.query.providerKey.findMany({
				where: {
					status: { eq: "active" },
					organizationId: { eq: project.organizationId },
				},
			});
			availableProviders = providerKeys.map((key) => key.provider);
		} else if (project.mode === "credits" || project.mode === "hybrid") {
			const providerKeys = await db.query.providerKey.findMany({
				where: {
					status: { eq: "active" },
					organizationId: { eq: project.organizationId },
				},
			});
			const databaseProviders = providerKeys.map((key) => key.provider);

			// Check which providers have environment tokens available
			const envProviders: string[] = [];
			const supportedProviders = providers
				.filter((p) => p.id !== "llmgateway")
				.map((p) => p.id);
			for (const provider of supportedProviders) {
				if (hasProviderEnvironmentToken(provider as Provider)) {
					envProviders.push(provider);
				}
			}

			if (project.mode === "credits") {
				availableProviders = envProviders;
			} else {
				availableProviders = [
					...new Set([...databaseProviders, ...envProviders]),
				];
			}
		}

		for (const modelDef of models) {
			if (modelDef.id === "auto" || modelDef.id === "custom") {
				continue;
			}

			// Skip deprecated models
			if (modelDef.deprecatedAt && new Date() > modelDef.deprecatedAt) {
				continue;
			}

			// Check if any of the model's providers are available
			const availableModelProviders = modelDef.providers.filter((provider) =>
				availableProviders.includes(provider.providerId),
			);

			if (availableModelProviders.length > 0) {
				usedProvider = availableModelProviders[0].providerId;
				usedModel = availableModelProviders[0].modelName;
				break;
			}
		}

		if (usedProvider === "llmgateway" || !usedProvider) {
			usedModel = "gpt-4o-mini";
			usedProvider = "openai";
		}
	} else if (
		(usedProvider === "llmgateway" && usedModel === "custom") ||
		usedModel === "custom"
	) {
		usedProvider = "llmgateway";
		usedModel = "custom";
	} else if (!usedProvider) {
		if (modelInfo.providers.length === 1) {
			usedProvider = modelInfo.providers[0].providerId;
			usedModel = modelInfo.providers[0].modelName;
		} else {
			const providerIds = modelInfo.providers.map((p) => p.providerId);
			const providerKeys = await db.query.providerKey.findMany({
				where: {
					status: {
						eq: "active",
					},
					organizationId: {
						eq: project.organizationId,
					},
					provider: {
						in: providerIds,
					},
				},
			});

			const availableProviders =
				project.mode === "api-keys"
					? providerKeys.map((key) => key.provider)
					: providers
							.filter((p) => p.id !== "llmgateway")
							.filter((p) => hasProviderEnvironmentToken(p.id as Provider))
							.map((p) => p.id);

			// Filter model providers to only those available
			const availableModelProviders = modelInfo.providers.filter((provider) =>
				availableProviders.includes(provider.providerId),
			);

			if (availableModelProviders.length === 0) {
				throw new HTTPException(400, {
					message:
						project.mode === "api-keys"
							? `No provider key set for any of the providers that support model ${usedModel}. Please add the provider key in the settings or switch the project mode to credits or hybrid.`
							: `No available provider could be found for model ${usedModel}`,
				});
			}

			const modelWithPricing = models.find((m) => m.id === usedModel);

			if (modelWithPricing) {
				const cheapestResult = getCheapestFromAvailableProviders(
					availableModelProviders,
					modelWithPricing,
				);

				if (cheapestResult) {
					usedProvider = cheapestResult.providerId;
					usedModel = cheapestResult.modelName;
				} else {
					usedProvider = availableModelProviders[0].providerId;
					usedModel = availableModelProviders[0].modelName;
				}
			} else {
				usedProvider = availableModelProviders[0].providerId;
				usedModel = availableModelProviders[0].modelName;
			}
		}
	}

	if (!usedProvider) {
		throw new HTTPException(500, {
			message: "An error occurred while routing the request",
		});
	}

	// Update baseModelName to match the final usedModel after routing
	// Find the model definition that corresponds to the final usedModel
	let finalModelInfo;
	if (usedProvider === "custom") {
		finalModelInfo = {
			model: usedModel,
			providers: [
				{
					providerId: "custom" as const,
					modelName: usedModel,
					inputPrice: 0,
					outputPrice: 0,
					contextSize: 8192,
					maxOutput: 4096,
					streaming: true,
					vision: false,
				},
			],
		};
	} else {
		finalModelInfo = models.find(
			(m) =>
				m.id === usedModel ||
				m.providers.some((p) => p.modelName === usedModel),
		);
	}

	const baseModelName = finalModelInfo?.id || usedModel;

	let url: string | undefined;

	// Get the provider key for the selected provider based on project mode

	let providerKey: InferSelectModel<typeof tables.providerKey> | undefined;
	let usedToken: string | undefined;

	if (project.mode === "credits" && usedProvider === "custom") {
		throw new HTTPException(400, {
			message:
				"Custom providers are not supported in credits mode. Please change your project settings to API keys or hybrid mode.",
		});
	}

	if (project.mode === "api-keys") {
		// Check if pro plan is required for API keys mode in hosted environment
		const isHosted = process.env.HOSTED === "true";
		const isPaidMode = process.env.PAID_MODE === "true";

		if (isHosted && isPaidMode) {
			const organization = await getOrganization(project.organizationId);

			if (!organization) {
				throw new HTTPException(500, {
					message: "Could not find organization",
				});
			}

			if (organization.plan !== "pro") {
				throw new HTTPException(402, {
					message:
						"API Keys mode requires a Pro plan. Please upgrade to Pro or switch to Credits mode.",
				});
			}
		}

		// Get the provider key from the database using cached helper function
		if (usedProvider === "custom" && customProviderName) {
			providerKey = await getCustomProviderKey(
				project.organizationId,
				customProviderName,
			);
		} else {
			providerKey = await getProviderKey(project.organizationId, usedProvider);
		}

		if (!providerKey) {
			const providerDisplayName =
				usedProvider === "custom" && customProviderName
					? customProviderName
					: usedProvider;
			throw new HTTPException(400, {
				message: `No API key set for provider: ${providerDisplayName}. Please add a provider key in your settings or add credits and switch to credits or hybrid mode.`,
			});
		}

		usedToken = providerKey.token;
	} else if (project.mode === "credits") {
		// Check if the organization has enough credits using cached helper function
		const organization = await getOrganization(project.organizationId);

		if (!organization) {
			throw new HTTPException(500, {
				message: "Could not find organization",
			});
		}

		if (organization.credits <= 0) {
			throw new HTTPException(402, {
				message: "Organization has insufficient credits",
			});
		}

		usedToken = getProviderTokenFromEnv(usedProvider);
	} else if (project.mode === "hybrid") {
		// First try to get the provider key from the database
		if (usedProvider === "custom" && customProviderName) {
			providerKey = await getCustomProviderKey(
				project.organizationId,
				customProviderName,
			);
		} else {
			providerKey = await getProviderKey(project.organizationId, usedProvider);
		}

		if (providerKey) {
			// Check if pro plan is required when using API keys in hybrid mode in hosted environment
			const isHosted = process.env.HOSTED === "true";
			const isPaidMode = process.env.PAID_MODE === "true";

			if (isHosted && isPaidMode) {
				const organization = await getOrganization(project.organizationId);

				if (!organization) {
					throw new HTTPException(500, {
						message: "Could not find organization",
					});
				}

				if (organization.plan !== "pro") {
					throw new HTTPException(402, {
						message:
							"Hybrid mode with API keys requires a Pro plan. Please upgrade to Pro or switch to Credits mode.",
					});
				}
			}

			usedToken = providerKey.token;
		} else {
			// No API key available, fall back to credits - no pro plan required
			const organization = await getOrganization(project.organizationId);

			if (!organization) {
				throw new HTTPException(500, {
					message: "Could not find organization",
				});
			}

			if (organization.credits <= 0) {
				throw new HTTPException(402, {
					message:
						"No API key set for provider and organization has insufficient credits",
				});
			}

			usedToken = getProviderTokenFromEnv(usedProvider);
		}
	} else {
		throw new HTTPException(400, {
			message: `Invalid project mode: ${project.mode}`,
		});
	}

	if (!usedToken) {
		throw new HTTPException(500, {
			message: `No token`,
		});
	}

	try {
		if (!usedProvider) {
			throw new HTTPException(400, {
				message: "No provider available for the requested model",
			});
		}

		url = getProviderEndpoint(
			usedProvider,
			providerKey?.baseUrl || undefined,
			usedModel,
			usedProvider === "google-ai-studio" ? usedToken : undefined,
			stream,
		);
	} catch (error) {
		if (usedProvider === "llmgateway" && usedModel !== "custom") {
			throw new HTTPException(400, {
				message: `Invalid model: ${usedModel} for provider: ${usedProvider}`,
			});
		}

		throw new HTTPException(500, {
			message: `Could not use provider: ${usedProvider}. ${error instanceof Error ? error.message : ""}`,
		});
	}

	if (!url) {
		throw new HTTPException(400, {
			message: `No base URL set for provider: ${usedProvider}. Please add a base URL in your settings.`,
		});
	}

	// Check if caching is enabled for this project
	const { enabled: cachingEnabled, duration: cacheDuration } =
		await isCachingEnabled(project.id);

	let cacheKey: string | null = null;
	let streamingCacheKey: string | null = null;

	if (cachingEnabled) {
		const cachePayload = {
			model: usedModel,
			messages,
			temperature,
			max_tokens,
			top_p,
			frequency_penalty,
			presence_penalty,
			response_format,
		};

		if (stream) {
			streamingCacheKey = generateStreamingCacheKey(cachePayload);
			const cachedStreamingResponse =
				await getStreamingCache(streamingCacheKey);
			if (cachedStreamingResponse?.metadata.completed) {
				// Extract final content and metadata from cached chunks
				let fullContent = "";
				let fullReasoningContent = "";
				let promptTokens = null;
				let completionTokens = null;
				let totalTokens = null;
				let reasoningTokens = null;
				let cachedTokens = null;

				for (const chunk of cachedStreamingResponse.chunks) {
					try {
						const chunkData = JSON.parse(chunk.data);

						// Extract content from chunk
						if (chunkData.choices?.[0]?.delta?.content) {
							fullContent += chunkData.choices[0].delta.content;
						}

						// Extract reasoning content from chunk
						if (chunkData.choices?.[0]?.delta?.reasoning_content) {
							fullReasoningContent +=
								chunkData.choices[0].delta.reasoning_content;
						}

						// Extract usage information (usually in the last chunks)
						if (chunkData.usage) {
							if (chunkData.usage.prompt_tokens) {
								promptTokens = chunkData.usage.prompt_tokens;
							}
							if (chunkData.usage.completion_tokens) {
								completionTokens = chunkData.usage.completion_tokens;
							}
							if (chunkData.usage.total_tokens) {
								totalTokens = chunkData.usage.total_tokens;
							}
							if (chunkData.usage.reasoning_tokens) {
								reasoningTokens = chunkData.usage.reasoning_tokens;
							}
							if (chunkData.usage.prompt_tokens_details?.cached_tokens) {
								cachedTokens =
									chunkData.usage.prompt_tokens_details.cached_tokens;
							}
						}
					} catch (e) {
						// Skip malformed chunks
						console.warn("Failed to parse cached chunk:", e);
					}
				}

				// Log the cached streaming request with reconstructed content
				const baseLogEntry = createLogEntry(
					requestId,
					project,
					apiKey,
					providerKey?.id,
					usedModel,
					usedProvider,
					requestedModel,
					requestedProvider,
					messages,
					temperature,
					max_tokens,
					top_p,
					frequency_penalty,
					presence_penalty,
					tools,
					tool_choice,
					source,
				);

				await insertLog({
					...baseLogEntry,
					duration: 0, // No processing time for cached response
					responseSize: JSON.stringify(cachedStreamingResponse).length,
					content: fullContent || null,
					reasoningContent: fullReasoningContent || null,
					finishReason: cachedStreamingResponse.metadata.finishReason,
					promptTokens: promptTokens?.toString() || null,
					completionTokens: completionTokens?.toString() || null,
					totalTokens: totalTokens?.toString() || null,
					reasoningTokens: reasoningTokens?.toString() || null,
					cachedTokens: cachedTokens?.toString() || null,
					hasError: false,
					streamed: true,
					canceled: false,
					errorDetails: null,
					inputCost: 0,
					outputCost: 0,
					cachedInputCost: 0,
					requestCost: 0,
					cost: 0,
					estimatedCost: false,
					cached: true,
					toolResults:
						(cachedStreamingResponse.metadata as any)?.toolResults || null,
				});

				// Return cached streaming response by replaying chunks with original timing
				return streamSSE(c, async (stream) => {
					let previousTimestamp = 0;

					for (const chunk of cachedStreamingResponse.chunks) {
						// Calculate delay based on original chunk timing
						const delay = Math.max(0, chunk.timestamp - previousTimestamp);
						// Cap the delay to prevent excessively long waits (max 1 second)
						const cappedDelay = Math.min(delay, 1000);

						if (cappedDelay > 0) {
							await new Promise<void>((resolve) => {
								setTimeout(() => resolve(), cappedDelay);
							});
						}

						await stream.writeSSE({
							data: chunk.data,
							id: String(chunk.eventId),
							event: chunk.event,
						});

						previousTimestamp = chunk.timestamp;
					}
				});
			}
		} else {
			cacheKey = generateCacheKey(cachePayload);
			const cachedResponse = cacheKey ? await getCache(cacheKey) : null;
			if (cachedResponse) {
				// Log the cached request
				const duration = 0; // No processing time needed
				const baseLogEntry = createLogEntry(
					requestId,
					project,
					apiKey,
					providerKey?.id,
					usedModel,
					usedProvider,
					requestedModel,
					requestedProvider,
					messages,
					temperature,
					max_tokens,
					top_p,
					frequency_penalty,
					presence_penalty,
					tools,
					tool_choice,
					source,
				);

				await insertLog({
					...baseLogEntry,
					duration,
					responseSize: JSON.stringify(cachedResponse).length,
					content: cachedResponse.choices?.[0]?.message?.content || null,
					reasoningContent:
						cachedResponse.choices?.[0]?.message?.reasoning_content || null,
					finishReason: cachedResponse.choices?.[0]?.finish_reason || null,
					promptTokens: cachedResponse.usage?.prompt_tokens || null,
					completionTokens: cachedResponse.usage?.completion_tokens || null,
					totalTokens: cachedResponse.usage?.total_tokens || null,
					reasoningTokens: cachedResponse.usage?.reasoning_tokens || null,
					cachedTokens: null,
					hasError: false,
					streamed: false,
					canceled: false,
					errorDetails: null,
					inputCost: 0,
					outputCost: 0,
					cachedInputCost: 0,
					requestCost: 0,
					cost: 0,
					estimatedCost: false,
					cached: true,
					toolResults: cachedResponse.choices?.[0]?.message?.tool_calls || null,
				});

				return c.json(cachedResponse);
			}
		}
	}

	// Validate max_tokens against model's maxOutput limit
	if (max_tokens !== undefined && finalModelInfo) {
		// Find the provider mapping for the used provider
		const providerMapping = finalModelInfo.providers.find(
			(p) => p.providerId === usedProvider && p.modelName === usedModel,
		);

		if (
			providerMapping &&
			"maxOutput" in providerMapping &&
			providerMapping.maxOutput !== undefined
		) {
			if (max_tokens > providerMapping.maxOutput) {
				throw new HTTPException(400, {
					message: `The requested max_tokens (${max_tokens}) exceeds the maximum output tokens allowed for model ${usedModel} (${providerMapping.maxOutput})`,
				});
			}
		}
	}

	// Check if streaming is requested and if the model/provider combination supports it
	if (stream) {
		if (getModelStreamingSupport(baseModelName, usedProvider) === false) {
			throw new HTTPException(400, {
				message: `Model ${usedModel} with provider ${usedProvider} does not support streaming`,
			});
		}
	}

	// Check if the request can be canceled
	const requestCanBeCanceled =
		providers.find((p) => p.id === usedProvider)?.cancellation === true;

	// Check if the model supports reasoning for Google providers
	const supportsReasoning = modelInfo.providers.some(
		(provider) => (provider as any).reasoning === true,
	);

	const requestBody = prepareRequestBody(
		usedProvider,
		usedModel,
		messages,
		stream,
		temperature,
		max_tokens,
		top_p,
		frequency_penalty,
		presence_penalty,
		response_format,
		tools,
		tool_choice,
		reasoning_effort,
		supportsReasoning,
	);

	const startTime = Date.now();

	// Handle streaming response if requested
	if (stream) {
		return streamSSE(c, async (stream) => {
			let eventId = 0;
			let canceled = false;
			let streamingError: unknown = null;

			// Streaming cache variables
			const streamingChunks: Array<{
				data: string;
				eventId: number;
				event?: string;
				timestamp: number;
			}> = [];
			const streamStartTime = Date.now();

			// Helper function to write SSE and capture for cache
			const writeSSEAndCache = async (sseData: {
				data: string;
				event?: string;
				id?: string;
			}) => {
				await stream.writeSSE(sseData);

				// Capture for streaming cache if enabled
				if (cachingEnabled && streamingCacheKey) {
					streamingChunks.push({
						data: sseData.data,
						eventId: sseData.id ? parseInt(sseData.id, 10) : eventId,
						event: sseData.event,
						timestamp: Date.now() - streamStartTime,
					});
				}
			};

			// Set up cancellation handling
			const controller = new AbortController();
			// Set up a listener for the request being aborted
			const onAbort = () => {
				if (requestCanBeCanceled) {
					canceled = true;
					controller.abort();
				}
			};

			// Add event listener for the abort event on the connection
			c.req.raw.signal.addEventListener("abort", onAbort);

			let res;
			try {
				const headers = getProviderHeaders(usedProvider, usedToken);
				headers["Content-Type"] = "application/json";

				res = await fetch(url, {
					method: "POST",
					headers,
					body: JSON.stringify(requestBody),
					signal: requestCanBeCanceled ? controller.signal : undefined,
				});
			} catch (error) {
				// Clean up the event listeners
				c.req.raw.signal.removeEventListener("abort", onAbort);

				if (error instanceof Error && error.name === "AbortError") {
					// Log the canceled request
					const baseLogEntry = createLogEntry(
						requestId,
						project,
						apiKey,
						providerKey?.id,
						usedModel,
						usedProvider,
						requestedModel,
						requestedProvider,
						messages,
						temperature,
						max_tokens,
						top_p,
						frequency_penalty,
						presence_penalty,
						tools,
						tool_choice,
						source,
					);

					await insertLog({
						...baseLogEntry,
						duration: Date.now() - startTime,
						responseSize: 0,
						content: null,
						reasoningContent: null,
						finishReason: "canceled",
						promptTokens: null,
						completionTokens: null,
						totalTokens: null,
						reasoningTokens: null,
						cachedTokens: null,
						hasError: false,
						streamed: true,
						canceled: true,
						errorDetails: null,
						cachedInputCost: null,
						requestCost: null,
						cached: false,
						toolResults: null,
					});

					// Send a cancellation event to the client
					await writeSSEAndCache({
						event: "canceled",
						data: JSON.stringify({
							message: "Request canceled by client",
						}),
						id: String(eventId++),
					});
					await writeSSEAndCache({
						event: "done",
						data: "[DONE]",
						id: String(eventId++),
					});
					return;
				} else {
					throw error;
				}
			}

			if (!res.ok) {
				const errorResponseText = await res.text();
				console.log(
					`Provider error - Status: ${res.status}, Text: ${errorResponseText}`,
				);

				// Determine the finish reason for error handling
				const finishReason = getFinishReasonForError(
					res.status,
					errorResponseText,
				);

				// For client errors, return the original provider error response
				let errorData;
				if (finishReason === "client_error") {
					try {
						errorData = JSON.parse(errorResponseText);
					} catch {
						// If we can't parse the original error, fall back to our format
						errorData = {
							error: {
								message: `Error from provider: ${res.status} ${res.statusText}`,
								type: finishReason,
								param: null,
								code: finishReason,
								responseText: errorResponseText,
							},
						};
					}
				} else {
					errorData = {
						error: {
							message: `Error from provider: ${res.status} ${res.statusText}`,
							type: finishReason,
							param: null,
							code: finishReason,
							responseText: errorResponseText,
						},
					};
				}

				await writeSSEAndCache({
					event: "error",
					data: JSON.stringify(errorData),
					id: String(eventId++),
				});
				await writeSSEAndCache({
					event: "done",
					data: "[DONE]",
					id: String(eventId++),
				});

				// Log the error in the database
				const baseLogEntry = createLogEntry(
					requestId,
					project,
					apiKey,
					providerKey?.id,
					usedModel,
					usedProvider,
					requestedModel,
					requestedProvider,
					messages,
					temperature,
					max_tokens,
					top_p,
					frequency_penalty,
					presence_penalty,
					tools,
					tool_choice,
					source,
				);

				await insertLog({
					...baseLogEntry,
					duration: Date.now() - startTime,
					responseSize: errorResponseText.length,
					content: null,
					reasoningContent: null,
					finishReason: getFinishReasonForError(res.status, errorResponseText),
					promptTokens: null,
					completionTokens: null,
					totalTokens: null,
					reasoningTokens: null,
					cachedTokens: null,
					hasError: true,
					streamed: true,
					canceled: false,
					errorDetails: {
						statusCode: res.status,
						statusText: res.statusText,
						responseText: errorResponseText,
					},
					cachedInputCost: null,
					requestCost: null,
					cached: false,
					toolResults: null,
				});

				return;
			}

			if (!res.body) {
				await writeSSEAndCache({
					event: "error",
					data: JSON.stringify({
						error: {
							message: "No response body from provider",
							type: "gateway_error",
							param: null,
							code: "gateway_error",
						},
					}),
					id: String(eventId++),
				});
				await writeSSEAndCache({
					event: "done",
					data: "[DONE]",
					id: String(eventId++),
				});
				return;
			}

			const reader = res.body.getReader();
			let fullContent = "";
			let fullReasoningContent = "";
			let finishReason = null;
			let promptTokens = null;
			let completionTokens = null;
			let totalTokens = null;
			let reasoningTokens = null;
			let cachedTokens = null;
			let streamingToolCalls = null;
			let buffer = ""; // Buffer for accumulating partial data across chunks
			const MAX_BUFFER_SIZE = 10 * 1024 * 1024; // 10MB limit

			try {
				while (true) {
					const { done, value } = await reader.read();
					if (done) {
						break;
					}

					// Convert the Uint8Array to a string
					const chunk = new TextDecoder().decode(value);
					buffer += chunk;

					// Check buffer size to prevent memory exhaustion
					if (buffer.length > MAX_BUFFER_SIZE) {
						console.warn(
							"Buffer size exceeded 10MB, clearing buffer to prevent memory exhaustion",
						);
						buffer = "";
						continue;
					}

					// Process SSE events from buffer
					let processedLength = 0;
					const bufferCopy = buffer;

					// Look for complete SSE events, handling events at buffer start
					let searchStart = 0;
					while (searchStart < bufferCopy.length) {
						// Find "data: " - could be at start of buffer or after newline
						let dataIndex = -1;

						if (searchStart === 0 && bufferCopy.startsWith("data: ")) {
							// Event at buffer start
							dataIndex = 0;
						} else {
							// Look for "\ndata: " pattern
							const newlineDataIndex = bufferCopy.indexOf(
								"\ndata: ",
								searchStart,
							);
							if (newlineDataIndex !== -1) {
								dataIndex = newlineDataIndex + 1; // Skip the newline
							}
						}

						if (dataIndex === -1) {
							break;
						}

						// Find the end of this SSE event
						// Look for next event or proper event termination
						let eventEnd = -1;

						// First, look for the next "data: " event (after a newline)
						const nextEventIndex = bufferCopy.indexOf(
							"\ndata: ",
							dataIndex + 6,
						);
						if (nextEventIndex !== -1) {
							// Found next data event, but we still need to check if there are SSE fields in between
							// For Anthropic, we might have: data: {...}\n\nevent: something\n\ndata: {...}
							const betweenEvents = bufferCopy.slice(
								dataIndex + 6,
								nextEventIndex,
							);
							const firstNewline = betweenEvents.indexOf("\n");

							if (firstNewline !== -1) {
								// Check if JSON up to first newline is valid
								const jsonCandidate = betweenEvents
									.slice(0, firstNewline)
									.trim();
								try {
									JSON.parse(jsonCandidate);
									// JSON is valid - end at first newline to exclude SSE fields
									eventEnd = dataIndex + 6 + firstNewline;
								} catch (_e) {
									// JSON is not complete, use the full segment to next data event
									eventEnd = nextEventIndex;
								}
							} else {
								// No newline found, use full segment
								eventEnd = nextEventIndex;
							}
						} else {
							// No next event found - check for proper event termination
							// SSE events should end with at least one newline
							const eventStartPos = dataIndex + 6; // Start of event data

							// For Anthropic SSE format, we need to be more careful about event boundaries
							// Try to find the end of the JSON data by looking for the closing brace
							let newlinePos = bufferCopy.indexOf("\n", eventStartPos);
							if (newlinePos !== -1) {
								// We found a newline - check if the JSON before it is valid
								const jsonCandidate = bufferCopy
									.slice(eventStartPos, newlinePos)
									.trim();
								try {
									JSON.parse(jsonCandidate);
									// JSON is valid - this newline marks the end of our data
									eventEnd = newlinePos;
								} catch (_e) {
									// JSON is not valid, check if there's more content after the newline
									if (newlinePos + 1 >= bufferCopy.length) {
										// Newline is at the end of buffer - event is incomplete
										break;
									} else {
										// There's content after the newline
										// Check if it's another SSE field (like event:, id:, retry:, etc.) or if the event continues
										const restOfBuffer = bufferCopy.slice(newlinePos + 1);

										// Check for SSE field patterns (event:, id:, retry:, etc.)
										// Handle both single and double newlines before checking for SSE fields
										const trimmedRest = restOfBuffer.replace(/^\n+/, ""); // Remove leading newlines
										if (
											restOfBuffer.startsWith("\n") || // Empty line - end of event
											restOfBuffer.startsWith("data: ") || // Next data field
											trimmedRest.startsWith("event:") || // Event field (after newlines)
											trimmedRest.startsWith("id:") || // ID field (after newlines)
											trimmedRest.startsWith("retry:") || // Retry field (after newlines)
											trimmedRest.match(/^[a-zA-Z_-]+:\s*/) // Generic SSE field pattern (after newlines, allow no space)
										) {
											// This is the end of our data event
											eventEnd = newlinePos;
										} else {
											// Content continues on next line - use full buffer
											eventEnd = bufferCopy.length;
										}
									}
								}
							} else {
								// No newline found after event data - event is incomplete
								// Try to detect if we have a complete JSON object
								const eventDataCandidate = bufferCopy.slice(eventStartPos);
								if (eventDataCandidate.length > 0) {
									// Try to validate if this looks like complete JSON
									try {
										JSON.parse(eventDataCandidate.trim());
										// If we can parse it, it's complete
										eventEnd = bufferCopy.length;
									} catch (_e) {
										// JSON parsing failed - event is incomplete
										break;
									}
								} else {
									// No event data yet
									break;
								}
							}
						}

						const eventData = bufferCopy.slice(dataIndex + 6, eventEnd).trim();

						// Debug logging for troublesome events
						if (eventData.includes("event:") || eventData.includes("id:")) {
							console.warn("Event data contains SSE field:", {
								eventData:
									eventData.substring(0, 200) +
									(eventData.length > 200 ? "..." : ""),
								dataIndex,
								eventEnd,
								bufferLength: bufferCopy.length,
								provider: usedProvider,
							});
						}

						if (eventData === "[DONE]") {
							// Calculate final usage if we don't have complete data
							let finalPromptTokens = promptTokens;
							let finalCompletionTokens = completionTokens;
							let finalTotalTokens = totalTokens;

							// Estimate missing tokens if needed using helper function
							if (finalPromptTokens === null) {
								const estimation = estimateTokens(
									usedProvider,
									messages,
									null,
									null,
									null,
								);
								finalPromptTokens = estimation.calculatedPromptTokens;
							}

							if (finalCompletionTokens === null) {
								finalCompletionTokens = estimateTokensFromContent(fullContent);
							}

							if (finalTotalTokens === null) {
								finalTotalTokens =
									(finalPromptTokens || 0) + (finalCompletionTokens || 0);
							}

							// Send final usage chunk before [DONE] if we have any usage data
							if (
								finalPromptTokens !== null ||
								finalCompletionTokens !== null ||
								finalTotalTokens !== null
							) {
								const finalUsageChunk = {
									id: `chatcmpl-${Date.now()}`,
									object: "chat.completion.chunk",
									created: Math.floor(Date.now() / 1000),
									model: usedModel,
									choices: [
										{
											index: 0,
											delta: {},
											finish_reason: null,
										},
									],
									usage: {
										prompt_tokens: finalPromptTokens || 0,
										completion_tokens: finalCompletionTokens || 0,
										total_tokens: finalTotalTokens || 0,
									},
								};

								await writeSSEAndCache({
									data: JSON.stringify(finalUsageChunk),
									id: String(eventId++),
								});
							}

							await writeSSEAndCache({
								event: "done",
								data: "[DONE]",
								id: String(eventId++),
							});

							processedLength = eventEnd;
						} else {
							// Try to parse JSON data - it might span multiple lines
							let data;
							try {
								data = JSON.parse(eventData);
							} catch (e) {
								// If JSON parsing fails, this might be an incomplete event
								// Since we already validated JSON completeness above, this is likely a format issue
								// Log the error and skip this chunk
								streamingError = e;
								console.warn("Failed to parse streaming JSON:", {
									error: e instanceof Error ? e.message : String(e),
									eventData:
										eventData.substring(0, 200) +
										(eventData.length > 200 ? "..." : ""),
									provider: usedProvider,
									eventLength: eventData.length,
									bufferEnd: eventEnd,
									bufferLength: bufferCopy.length,
								});

								processedLength = eventEnd;
								searchStart = eventEnd;
								continue;
							}

							// Transform streaming responses to OpenAI format for all providers
							const transformedData = transformStreamingChunkToOpenAIFormat(
								usedProvider,
								usedModel,
								data,
							);

							// For Anthropic, if we have partial usage data, complete it
							if (usedProvider === "anthropic" && transformedData.usage) {
								const usage = transformedData.usage;
								if (
									usage.output_tokens !== undefined &&
									usage.prompt_tokens === undefined
								) {
									// Estimate prompt tokens if not provided
									const estimation = estimateTokens(
										usedProvider,
										messages,
										null,
										null,
										null,
									);
									const estimatedPromptTokens =
										estimation.calculatedPromptTokens;
									transformedData.usage = {
										prompt_tokens: estimatedPromptTokens,
										completion_tokens: usage.output_tokens,
										total_tokens: estimatedPromptTokens + usage.output_tokens,
									};
								}
							}

							// For Google providers, add usage information when available
							if (
								usedProvider === "google-vertex" ||
								usedProvider === "google-ai-studio"
							) {
								const usage = extractTokenUsage(
									data,
									usedProvider,
									fullContent,
								);

								// If we have usage data from Google, add it to the streaming chunk
								if (
									usage.promptTokens !== null ||
									usage.completionTokens !== null ||
									usage.totalTokens !== null
								) {
									transformedData.usage = {
										prompt_tokens: usage.promptTokens,
										completion_tokens: usage.completionTokens,
										total_tokens: usage.totalTokens,
										...(usage.reasoningTokens !== null && {
											reasoning_tokens: usage.reasoningTokens,
										}),
									};
								}
							}

							await writeSSEAndCache({
								data: JSON.stringify(transformedData),
								id: String(eventId++),
							});

							// Extract content for logging using helper function
							const contentChunk = extractContentFromProvider(
								data,
								usedProvider,
							);
							if (contentChunk) {
								fullContent += contentChunk;
							}

							// Extract reasoning content for logging using helper function
							const reasoningContentChunk = extractReasoningContentFromProvider(
								data,
								usedProvider,
							);
							if (reasoningContentChunk) {
								fullReasoningContent += reasoningContentChunk;
							}

							// Extract and accumulate tool calls
							const toolCallsChunk = extractToolCallsFromProvider(
								data,
								usedProvider,
							);
							if (toolCallsChunk && toolCallsChunk.length > 0) {
								if (!streamingToolCalls) {
									streamingToolCalls = [];
								}
								// Merge tool calls (accumulating function arguments)
								for (const newCall of toolCallsChunk) {
									const existingCall = streamingToolCalls.find(
										(call) => call.id === newCall.id,
									);
									if (existingCall) {
										// Accumulate function arguments
										if (newCall.function?.arguments) {
											existingCall.function.arguments =
												(existingCall.function.arguments || "") +
												newCall.function.arguments;
										}
									} else {
										streamingToolCalls.push({ ...newCall });
									}
								}
							}

							// Handle provider-specific finish reason extraction
							switch (usedProvider) {
								case "google-vertex":
								case "google-ai-studio":
									if (data.candidates?.[0]?.finishReason) {
										finishReason = data.candidates[0].finishReason;
									}
									break;
								case "anthropic":
									if (
										data.type === "message_delta" &&
										data.delta?.stop_reason
									) {
										finishReason = data.delta.stop_reason;
									} else if (data.type === "message_stop" || data.stop_reason) {
										finishReason = data.stop_reason || "end_turn";
									} else if (data.delta?.stop_reason) {
										finishReason = data.delta.stop_reason;
									}
									break;
								default: // OpenAI format
									if (data.choices && data.choices[0]?.finish_reason) {
										finishReason = data.choices[0].finish_reason;
									}
									break;
							}

							// Extract token usage using helper function
							const usage = extractTokenUsage(data, usedProvider, fullContent);
							if (usage.promptTokens !== null) {
								promptTokens = usage.promptTokens;
							}
							if (usage.completionTokens !== null) {
								completionTokens = usage.completionTokens;
							}
							if (usage.totalTokens !== null) {
								totalTokens = usage.totalTokens;
							}
							if (usage.reasoningTokens !== null) {
								reasoningTokens = usage.reasoningTokens;
							}
							if (usage.cachedTokens !== null) {
								cachedTokens = usage.cachedTokens;
							}

							// Estimate tokens if not provided and we have a finish reason
							if (finishReason && (!promptTokens || !completionTokens)) {
								if (!promptTokens) {
									const estimation = estimateTokens(
										usedProvider,
										messages,
										null,
										null,
										null,
									);
									promptTokens = estimation.calculatedPromptTokens;
								}

								if (!completionTokens) {
									completionTokens = estimateTokensFromContent(fullContent);
								}

								totalTokens = (promptTokens || 0) + (completionTokens || 0);
							}

							processedLength = eventEnd;
						}

						searchStart = eventEnd;
					}

					// Remove processed data from buffer
					if (processedLength > 0) {
						buffer = bufferCopy.slice(processedLength);
					}
				}
			} catch (error) {
				if (error instanceof Error && error.name === "AbortError") {
					canceled = true;
				} else {
					console.error("Error reading stream:", error);

					// Forward the error to the client
					try {
						await stream.writeSSE({
							event: "error",
							data: JSON.stringify({
								error: {
									message: `Streaming error: ${error instanceof Error ? error.message : String(error)}`,
									type: "gateway_error",
									param: null,
									code: "streaming_error",
								},
							}),
							id: String(eventId++),
						});
						await stream.writeSSE({
							event: "done",
							data: "[DONE]",
							id: String(eventId++),
						});
					} catch (sseError) {
						console.error("Failed to send error SSE:", sseError);
					}

					// Mark as having an error for logging
					streamingError = error;
				}
			} finally {
				// Clean up the event listeners
				c.req.raw.signal.removeEventListener("abort", onAbort);

				// Log the streaming request
				const duration = Date.now() - startTime;

				// Calculate estimated tokens if not provided
				let calculatedPromptTokens = promptTokens;
				let calculatedCompletionTokens = completionTokens;
				let calculatedTotalTokens = totalTokens;

				// Estimate tokens for providers that don't provide them during streaming
				if (!promptTokens || !completionTokens) {
					if (!promptTokens && messages && messages.length > 0) {
						try {
							// Convert messages to the format expected by gpt-tokenizer
							const chatMessages: any[] = messages.map((m) => ({
								role: m.role as "user" | "assistant" | "system" | undefined,
								content: m.content || "",
								name: m.name,
							}));
							calculatedPromptTokens = encodeChat(
								chatMessages,
								DEFAULT_TOKENIZER_MODEL,
							).length;
						} catch (error) {
							// Fallback to simple estimation if encoding fails
							console.error(
								`Failed to encode chat messages in streaming: ${error}`,
							);
							calculatedPromptTokens =
								messages.reduce((acc, m) => acc + (m.content?.length || 0), 0) /
								4;
						}
					}

					if (!completionTokens && fullContent) {
						try {
							calculatedCompletionTokens = encode(fullContent).length;
						} catch (error) {
							// Fallback to simple estimation if encoding fails
							console.error(
								`Failed to encode completion text in streaming: ${error}`,
							);
							calculatedCompletionTokens =
								estimateTokensFromContent(fullContent);
						}
					}

					calculatedTotalTokens =
						(calculatedPromptTokens || 0) + (calculatedCompletionTokens || 0);
				}

				// Send final usage chunk if we need to send usage data
				// This includes cases where:
				// 1. No usage tokens were provided at all (all null)
				// 2. Some tokens are missing (e.g., Google AI Studio doesn't provide completion tokens during streaming)
				const needsUsageChunk =
					(promptTokens === null &&
						completionTokens === null &&
						totalTokens === null &&
						(calculatedPromptTokens !== null ||
							calculatedCompletionTokens !== null)) ||
					(completionTokens === null && calculatedCompletionTokens !== null);

				if (needsUsageChunk) {
					try {
						const finalUsageChunk = {
							id: `chatcmpl-${Date.now()}`,
							object: "chat.completion.chunk",
							created: Math.floor(Date.now() / 1000),
							model: usedModel,
							choices: [
								{
									index: 0,
									delta: {},
									finish_reason: null,
								},
							],
							usage: {
								prompt_tokens: Math.round(
									promptTokens || calculatedPromptTokens || 0,
								),
								completion_tokens: Math.round(
									completionTokens || calculatedCompletionTokens || 0,
								),
								total_tokens: Math.round(
									totalTokens || calculatedTotalTokens || 0,
								),
								...(cachedTokens !== null && {
									prompt_tokens_details: {
										cached_tokens: cachedTokens,
									},
								}),
							},
						};

						await writeSSEAndCache({
							data: JSON.stringify(finalUsageChunk),
							id: String(eventId++),
						});

						// Send final [DONE] if we haven't already
						await writeSSEAndCache({
							event: "done",
							data: "[DONE]",
							id: String(eventId++),
						});
					} catch (error) {
						console.error("Error sending final usage chunk:", error);
					}
				}

				const costs = calculateCosts(
					usedModel,
					usedProvider,
					calculatedPromptTokens,
					calculatedCompletionTokens,
					cachedTokens,
					{
						prompt: messages.map((m) => m.content).join("\n"),
						completion: fullContent,
					},
				);

				const baseLogEntry = createLogEntry(
					requestId,
					project,
					apiKey,
					providerKey?.id,
					usedModel,
					usedProvider,
					requestedModel,
					requestedProvider,
					messages,
					temperature,
					max_tokens,
					top_p,
					frequency_penalty,
					presence_penalty,
					tools,
					tool_choice,
					source,
				);

				await insertLog({
					...baseLogEntry,
					duration,
					responseSize: fullContent.length,
					content: fullContent,
					reasoningContent: fullReasoningContent || null,
					finishReason: finishReason,
					promptTokens: calculatedPromptTokens?.toString() || null,
					completionTokens: calculatedCompletionTokens?.toString() || null,
					totalTokens: calculatedTotalTokens?.toString() || null,
					reasoningTokens: reasoningTokens,
					cachedTokens: cachedTokens?.toString() || null,
					hasError: streamingError !== null,
					errorDetails: streamingError
						? {
								statusCode: 500,
								statusText: "Streaming Error",
								responseText:
									streamingError instanceof Error
										? streamingError.message
										: String(streamingError),
							}
						: null,
					streamed: true,
					canceled: canceled,
					inputCost: costs.inputCost,
					outputCost: costs.outputCost,
					cachedInputCost: costs.cachedInputCost,
					requestCost: costs.requestCost,
					cost: costs.totalCost,
					estimatedCost: costs.estimatedCost,
					cached: false,
					tools,
					toolResults: streamingToolCalls,
					toolChoice: tool_choice,
				});
				// Save streaming cache if enabled and not canceled
				if (cachingEnabled && streamingCacheKey && !canceled && finishReason) {
					try {
						const streamingCacheData = {
							chunks: streamingChunks,
							metadata: {
								model: usedModel,
								provider: usedProvider,
								finishReason: finishReason,
								totalChunks: streamingChunks.length,
								duration: duration,
								completed: true,
							},
						};

						await setStreamingCache(
							streamingCacheKey,
							streamingCacheData,
							cacheDuration,
						);
					} catch (error) {
						console.error("Error saving streaming cache:", error);
					}
				}
			}
		});
	}

	// Handle non-streaming response
	const controller = new AbortController();
	// Set up a listener for the request being aborted
	const onAbort = () => {
		if (requestCanBeCanceled) {
			controller.abort();
		}
	};

	// Add event listener for the 'close' event on the connection
	c.req.raw.signal.addEventListener("abort", onAbort);

	let canceled = false;
	let res;
	try {
		const headers = getProviderHeaders(usedProvider, usedToken);
		headers["Content-Type"] = "application/json";
		res = await fetch(url, {
			method: "POST",
			headers,
			body: JSON.stringify(requestBody),
			signal: requestCanBeCanceled ? controller.signal : undefined,
		});
	} catch (error) {
		if (error instanceof Error && error.name === "AbortError") {
			canceled = true;
		} else {
			throw error;
		}
	} finally {
		// Clean up the event listener
		c.req.raw.signal.removeEventListener("abort", onAbort);
	}

	const duration = Date.now() - startTime;

	// If the request was canceled, log it and return a response
	if (canceled) {
		// Log the canceled request
		const baseLogEntry = createLogEntry(
			requestId,
			project,
			apiKey,
			providerKey?.id,
			usedModel,
			usedProvider,
			requestedModel,
			requestedProvider,
			messages,
			temperature,
			max_tokens,
			top_p,
			frequency_penalty,
			presence_penalty,
			tools,
			tool_choice,
			source,
		);

		await insertLog({
			...baseLogEntry,
			duration,
			responseSize: 0,
			content: null,
			reasoningContent: null,
			finishReason: "canceled",
			promptTokens: null,
			completionTokens: null,
			totalTokens: null,
			reasoningTokens: null,
			cachedTokens: null,
			hasError: false,
			streamed: false,
			canceled: true,
			errorDetails: null,
			cachedInputCost: null,
			requestCost: null,
			estimatedCost: false,
			cached: false,
			toolResults: null,
		});

		return c.json(
			{
				error: {
					message: "Request canceled by client",
					type: "canceled",
					param: null,
					code: "request_canceled",
				},
			},
			400,
		); // Using 400 status code for client closed request
	}

	if (res && !res.ok) {
		// Get the error response text
		const errorResponseText = await res.text();

		console.log(
			`Provider error - Status: ${res.status}, Text: ${errorResponseText}`,
		);

		// Determine the finish reason first
		const finishReason = getFinishReasonForError(res.status, errorResponseText);

		// Log the error in the database
		const baseLogEntry = createLogEntry(
			requestId,
			project,
			apiKey,
			providerKey?.id,
			usedModel,
			usedProvider,
			requestedModel,
			requestedProvider,
			messages,
			temperature,
			max_tokens,
			top_p,
			frequency_penalty,
			presence_penalty,
			tools,
			tool_choice,
			source,
		);

		await insertLog({
			...baseLogEntry,
			duration,
			responseSize: errorResponseText.length,
			content: null,
			reasoningContent: null,
			finishReason,
			promptTokens: null,
			completionTokens: null,
			totalTokens: null,
			reasoningTokens: null,
			cachedTokens: null,
			hasError: true,
			streamed: false,
			canceled: false,
			errorDetails: (() => {
				// For client errors, try to parse the original error and include the message
				if (finishReason === "client_error") {
					try {
						const originalError = JSON.parse(errorResponseText);
						return {
							statusCode: res.status,
							statusText: res.statusText,
							responseText: errorResponseText,
							message: originalError.error?.message || errorResponseText,
						};
					} catch {
						// If parsing fails, use default format
					}
				}
				return {
					statusCode: res.status,
					statusText: res.statusText,
					responseText: errorResponseText,
				};
			})(),
			cachedInputCost: null,
			requestCost: null,
			estimatedCost: false,
			cached: false,
			toolResults: null,
		});

		// Use the already determined finish reason for response logic

		// For client errors, return the original provider error response
		if (finishReason === "client_error") {
			try {
				const originalError = JSON.parse(errorResponseText);
				return c.json(originalError, res.status as 400);
			} catch {
				// If we can't parse the original error, fall back to our format
			}
		}

		// Return our wrapped error response for non-client errors
		return c.json(
			{
				error: {
					message: `Error from provider: ${res.status} ${res.statusText}`,
					type: finishReason,
					param: null,
					code: finishReason,
					requestedProvider,
					usedProvider,
					requestedModel,
					usedModel,
					responseText: errorResponseText,
				},
			},
			500,
		);
	}

	if (!res) {
		throw new Error("No response from provider");
	}

	const json = await res.json();
	if (process.env.NODE_ENV !== "production") {
		console.log("response", JSON.stringify(json, null, 2));
	}
	const responseText = JSON.stringify(json);

	// Extract content and token usage based on provider
	const {
		content,
		reasoningContent,
		finishReason,
		promptTokens,
		completionTokens,
		totalTokens,
		reasoningTokens,
		cachedTokens,
		toolResults,
	} = parseProviderResponse(usedProvider, json);

	// Estimate tokens if not provided by the API
	const { calculatedPromptTokens, calculatedCompletionTokens } = estimateTokens(
		usedProvider,
		messages,
		content,
		promptTokens,
		completionTokens,
	);

	const costs = calculateCosts(
		usedModel,
		usedProvider,
		calculatedPromptTokens,
		calculatedCompletionTokens,
		cachedTokens,
		{
			prompt: messages.map((m) => m.content).join("\n"),
			completion: content,
		},
	);

	const baseLogEntry = createLogEntry(
		requestId,
		project,
		apiKey,
		providerKey?.id,
		usedModel,
		usedProvider,
		requestedModel,
		requestedProvider,
		messages,
		temperature,
		max_tokens,
		top_p,
		frequency_penalty,
		presence_penalty,
		tools,
		tool_choice,
		source,
	);

	await insertLog({
		...baseLogEntry,
		duration,
		responseSize: responseText.length,
		content: content,
		reasoningContent: reasoningContent,
		finishReason: finishReason,
		promptTokens: calculatedPromptTokens?.toString() || null,
		completionTokens: calculatedCompletionTokens?.toString() || null,
		totalTokens:
			totalTokens ||
			(
				(calculatedPromptTokens || 0) + (calculatedCompletionTokens || 0)
			).toString(),
		reasoningTokens: reasoningTokens,
		cachedTokens: cachedTokens?.toString() || null,
		hasError: false,
		streamed: false,
		canceled: false,
		errorDetails: null,
		inputCost: costs.inputCost,
		outputCost: costs.outputCost,
		cachedInputCost: costs.cachedInputCost,
		requestCost: costs.requestCost,
		cost: costs.totalCost,
		estimatedCost: costs.estimatedCost,
		cached: false,
		tools,
		toolResults,
		toolChoice: tool_choice,
	});

	// Transform response to OpenAI format for non-OpenAI providers
	const transformedResponse = transformToOpenAIFormat(
		usedProvider,
		usedModel,
		json,
		content,
		reasoningContent,
		finishReason,
		calculatedPromptTokens,
		calculatedCompletionTokens,
		(calculatedPromptTokens || 0) +
			(calculatedCompletionTokens || 0) +
			(reasoningTokens || 0),
		reasoningTokens,
		cachedTokens,
		toolResults,
	);

	if (cachingEnabled && cacheKey && !stream) {
		await setCache(cacheKey, transformedResponse, cacheDuration);
	}

	return c.json(transformedResponse);
});
