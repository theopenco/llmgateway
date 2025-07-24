import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import {
	db,
	shortid,
	type InferSelectModel,
	type Project,
	type tables,
	type ApiKey,
} from "@llmgateway/db";
import {
	getCheapestFromAvailableProviders,
	getProviderEndpoint,
	getProviderHeaders,
	getModelStreamingSupport,
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
	getCache,
	getCustomProviderKey,
	getOrganization,
	getProject,
	getProviderKey,
	isCachingEnabled,
	setCache,
} from "../lib/cache";
import { calculateCosts } from "../lib/costs";
import { insertLog } from "../lib/logs";
import {
	hasProviderEnvironmentToken,
	getProviderEnvVar,
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
 * Determines the appropriate finish reason based on HTTP status code
 * 5xx status codes indicate upstream provider errors
 * 4xx status codes indicate client/gateway errors
 */
function getFinishReasonForError(statusCode: number): string {
	return statusCode >= 500 ? "upstream_error" : "gateway_error";
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
		mode: project.mode,
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
			break;
		case "google-vertex":
		case "google-ai-studio":
			content = json.candidates?.[0]?.content?.parts?.[0]?.text || null;
			finishReason = json.candidates?.[0]?.finishReason || null;
			promptTokens = json.usageMetadata?.promptTokenCount || null;
			completionTokens = json.usageMetadata?.candidatesTokenCount || null;
			reasoningTokens = json.usageMetadata?.thoughtsTokenCount || null;
			totalTokens =
				promptTokens !== null && completionTokens !== null
					? promptTokens + completionTokens
					: json.usageMetadata?.totalTokenCount || null;
			break;
		case "inference.net":
		case "kluster.ai":
		case "together.ai":
		case "groq":
		case "deepseek":
		case "perplexity":
		case "alibaba":
			reasoningContent = json.choices?.[0]?.message?.reasoning_content || null;
			content = json.choices?.[0]?.message?.content || null;
			finishReason = json.choices?.[0]?.finish_reason || null;
			promptTokens = json.usage?.prompt_tokens || null;
			completionTokens = json.usage?.completion_tokens || null;
			reasoningTokens = json.usage?.reasoning_tokens || null;
			totalTokens =
				promptTokens !== null && completionTokens !== null
					? promptTokens + completionTokens
					: json.usage?.total_tokens || null;
			break;
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
			break;
		default: // OpenAI format
			// Handle both regular content and tool calls
			if (json.choices?.[0]?.message?.tool_calls) {
				// For tool calls, we'll keep the original JSON structure
				// but set content to null since it's in tool_calls
				content = null;
			} else {
				content = json.choices?.[0]?.message?.content || null;
			}
			// Extract reasoning content for reasoning-capable models
			reasoningContent = json.choices?.[0]?.message?.reasoning_content || null;
			finishReason = json.choices?.[0]?.finish_reason || null;
			promptTokens = json.usage?.prompt_tokens || null;
			completionTokens = json.usage?.completion_tokens || null;
			reasoningTokens = json.usage?.reasoning_tokens || null;
			cachedTokens = json.usage?.prompt_tokens_details?.cached_tokens || null;
			totalTokens = json.usage?.total_tokens || null;
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
					content: m.content || "",
					name: m.name,
				}));
				calculatedPromptTokens = encodeChat(
					chatMessages,
					DEFAULT_TOKENIZER_MODEL,
				).length;
			} catch (error) {
				// Fallback to simple estimation if encoding fails
				console.error(`Failed to encode chat messages: ${error}`);
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
		case "google-ai-studio":
			return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
		case "anthropic":
			if (data.type === "content_block_delta" && data.delta?.text) {
				return data.delta.text;
			} else if (data.delta?.text) {
				return data.delta.text;
			}
			return "";
		case "inference.net":
		case "kluster.ai":
		case "together.ai":
		case "groq":
		case "deepseek":
		case "perplexity":
		case "alibaba":
			return data.choices?.[0]?.delta?.content || "";
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
		case "inference.net":
		case "kluster.ai":
		case "together.ai":
		case "groq":
		case "deepseek":
		case "perplexity":
		case "alibaba":
			return data.choices?.[0]?.delta?.reasoning_content || "";
		default: // OpenAI format
			return data.choices?.[0]?.delta?.reasoning_content || "";
	}
}

/**
 * Extracts token usage information from streaming data based on provider format
 */
function extractTokenUsage(data: any, provider: Provider) {
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
				totalTokens = data.usageMetadata.totalTokenCount || null;
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
		case "inference.net":
		case "kluster.ai":
		case "together.ai":
		case "groq":
		case "deepseek":
		case "perplexity":
		case "alibaba":
			if (data.usage) {
				promptTokens = data.usage.prompt_tokens || null;
				completionTokens = data.usage.completion_tokens || null;
				totalTokens = data.usage.total_tokens || null;
				reasoningTokens = data.usage.reasoning_tokens || null;
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
						},
						finish_reason:
							finishReason === "STOP"
								? "stop"
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
						},
						finish_reason:
							finishReason === "end_turn"
								? "stop"
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
		case "kluster.ai":
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
					id: `chatcmpl-${Date.now()}`,
					object: "chat.completion.chunk",
					created: Math.floor(Date.now() / 1000),
					model: usedModel,
					choices: [
						{
							index: 0,
							delta: {
								content: data.candidates[0].content.parts[0].text,
								role: "assistant",
							},
							finish_reason: null,
						},
					],
					usage:
						data.usageMetadata && data.usageMetadata.candidatesTokenCount
							? {
									prompt_tokens: data.usageMetadata.promptTokenCount || 0,
									completion_tokens: data.usageMetadata.candidatesTokenCount,
									total_tokens: data.usageMetadata.totalTokenCount || 0,
								}
							: null,
				};
			} else if (data.candidates?.[0]?.finishReason) {
				const finishReason = data.candidates[0].finishReason;
				transformedData = {
					id: `chatcmpl-${Date.now()}`,
					object: "chat.completion.chunk",
					created: Math.floor(Date.now() / 1000),
					model: usedModel,
					choices: [
						{
							index: 0,
							delta: {
								role: "assistant",
							},
							finish_reason:
								finishReason === "STOP"
									? "stop"
									: finishReason?.toLowerCase() || "stop",
						},
					],
					usage:
						data.usageMetadata && data.usageMetadata.candidatesTokenCount
							? {
									prompt_tokens: data.usageMetadata.promptTokenCount || 0,
									completion_tokens: data.usageMetadata.candidatesTokenCount,
									total_tokens: data.usageMetadata.totalTokenCount || 0,
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
										role: "assistant",
									},
							finish_reason: data.finish_reason || null,
						},
					],
					usage: data.usage || null,
				};
			} else {
				// Even if the response has the correct format, ensure role is set in delta
				transformedData = {
					...data,
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
					schema: z.object({
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
						reasoning_effort: z
							.enum(["low", "medium", "high"])
							.optional()
							.openapi({
								description:
									"Controls the reasoning effort for reasoning-capable models",
								example: "medium",
							}),
					}),
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
	} = c.req.valid("json");

	// Extract or generate request ID
	const requestId = c.req.header("x-request-id") || shortid(40);

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

	if (!apiKey) {
		throw new HTTPException(401, {
			message:
				"Unauthorized: Invalid LLMGateway API token. Please make sure the token is not deleted or disabled. Go to the LLMGateway 'API Keys' page to generate a new token.",
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
			usedToken = providerKey.token;
		} else {
			// Check if the organization has enough credits
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
	if (cachingEnabled && !stream) {
		// Don't cache streaming responses
		cacheKey = generateCacheKey({
			model: usedModel,
			messages,
			temperature,
			max_tokens,
			top_p,
			frequency_penalty,
			presence_penalty,
			response_format,
		});

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
			});

			return c.json(cachedResponse);
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
	);

	const startTime = Date.now();

	// Handle streaming response if requested
	if (stream) {
		return streamSSE(c, async (stream) => {
			let eventId = 0;
			let canceled = false;

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
					});

					// Send a cancellation event to the client
					await stream.writeSSE({
						event: "canceled",
						data: JSON.stringify({
							message: "Request canceled by client",
						}),
						id: String(eventId++),
					});
					await stream.writeSSE({
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

				await stream.writeSSE({
					event: "error",
					data: JSON.stringify({
						error: {
							message: `Error from provider: ${res.status} ${res.statusText}`,
							type: getFinishReasonForError(res.status),
							param: null,
							code: getFinishReasonForError(res.status),
							responseText: errorResponseText,
						},
					}),
					id: String(eventId++),
				});
				await stream.writeSSE({
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
				);

				await insertLog({
					...baseLogEntry,
					duration: Date.now() - startTime,
					responseSize: errorResponseText.length,
					content: null,
					reasoningContent: null,
					finishReason: getFinishReasonForError(res.status),
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
				});

				return;
			}

			if (!res.body) {
				await stream.writeSSE({
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
				await stream.writeSSE({
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

					// For Google providers, handle raw JSON objects across newlines
					if (
						usedProvider === "google-vertex" ||
						usedProvider === "google-ai-studio"
					) {
						// Google sends raw JSON objects across multiple newlines, not SSE format
						// We need to parse complete JSON objects from the accumulated buffer
						let processedData = false;

						// Helper function to try parsing JSON from different positions
						const tryParseJSON = (str: string, startIndex: number) => {
							for (let i = startIndex; i < str.length; i++) {
								try {
									const substr = str.substring(startIndex, i + 1);
									return { data: JSON.parse(substr), endIndex: i };
								} catch {
									continue;
								}
							}
							return null;
						};

						// Try to find and parse complete JSON objects
						while (buffer.length > 0) {
							// Find the start of a JSON object
							const jsonStartIndex = buffer.indexOf("{");

							if (jsonStartIndex === -1) {
								// No JSON start found, clear buffer
								buffer = "";
								break;
							}

							// Try to parse JSON starting from this position
							const parseResult = tryParseJSON(buffer, jsonStartIndex);

							if (parseResult) {
								// Successfully parsed a JSON object
								const data = parseResult.data;
								buffer = buffer.substring(parseResult.endIndex + 1);
								processedData = true;

								// Transform streaming responses to OpenAI format
								const transformedData = transformStreamingChunkToOpenAIFormat(
									usedProvider,
									usedModel,
									data,
								);

								await stream.writeSSE({
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
								const reasoningContentChunk =
									extractReasoningContentFromProvider(data, usedProvider);
								if (reasoningContentChunk) {
									fullReasoningContent += reasoningContentChunk;
								}

								// Check for finish reason
								if (data.candidates && data.candidates[0]?.finishReason) {
									finishReason = data.candidates[0].finishReason;

									// Send final chunk when we get a finish reason
									if (finishReason) {
										await stream.writeSSE({
											event: "done",
											data: "[DONE]",
											id: String(eventId++),
										});
									}
								}

								// Extract token usage using helper function
								const usage = extractTokenUsage(data, usedProvider);
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

								// For Google AI Studio, if candidatesTokenCount is not provided,
								// we'll calculate it later from the fullContent
								if (
									(usedProvider === "google-ai-studio" ||
										usedProvider === "google-vertex") &&
									!usage.completionTokens &&
									fullContent
								) {
									completionTokens = null; // Mark as missing so we calculate later
								}
							} else {
								// No complete JSON object found, try to find next JSON start
								const nextStart = buffer.indexOf("{", jsonStartIndex + 1);
								if (nextStart !== -1) {
									// Skip to next potential JSON start
									buffer = buffer.substring(nextStart);
								} else {
									// No more JSON starts found, break and wait for more data
									break;
								}
							}
						}

						// If we processed data but buffer is empty or very small, keep a bit for next iteration
						if (processedData && buffer.length < 50) {
							// Keep small remainder in buffer in case it's part of next JSON
						}
					} else {
						// For non-Google providers, use the original line-by-line processing
						const lines = buffer.split("\n");
						// Keep the last line in buffer if it's incomplete (doesn't end with newline)
						if (
							buffer.length > 0 &&
							!buffer.endsWith("\n") &&
							lines.length > 1
						) {
							buffer = lines.pop() || "";
						} else {
							buffer = "";
						}

						for (const line of lines) {
							if (line.startsWith("data: ")) {
								if (line === "data: [DONE]") {
									// Calculate final usage if we don't have complete data
									let finalPromptTokens = promptTokens;
									let finalCompletionTokens = completionTokens;
									let finalTotalTokens = totalTokens;

									// Estimate missing tokens if needed using helper function
									if (finalPromptTokens === null) {
										finalPromptTokens = Math.round(
											messages.reduce(
												(acc, m) => acc + (m.content?.length || 0),
												0,
											) / 4,
										);
									}

									if (finalCompletionTokens === null) {
										finalCompletionTokens =
											estimateTokensFromContent(fullContent);
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

										await stream.writeSSE({
											data: JSON.stringify(finalUsageChunk),
											id: String(eventId++),
										});
									}

									await stream.writeSSE({
										event: "done",
										data: "[DONE]",
										id: String(eventId++),
									});
								} else {
									try {
										const data = JSON.parse(line.substring(6));

										// Transform streaming responses to OpenAI format for all providers
										const transformedData =
											transformStreamingChunkToOpenAIFormat(
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
												const estimatedPromptTokens = Math.round(
													messages.reduce(
														(acc, m) => acc + (m.content?.length || 0),
														0,
													) / 4,
												);
												transformedData.usage = {
													prompt_tokens: estimatedPromptTokens,
													completion_tokens: usage.output_tokens,
													total_tokens:
														estimatedPromptTokens + usage.output_tokens,
												};
											}
										}

										await stream.writeSSE({
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
										const reasoningContentChunk =
											extractReasoningContentFromProvider(data, usedProvider);
										if (reasoningContentChunk) {
											fullReasoningContent += reasoningContentChunk;
										}

										// Handle provider-specific finish reason extraction
										switch (usedProvider) {
											case "anthropic":
												if (
													data.type === "message_delta" &&
													data.delta?.stop_reason
												) {
													finishReason = data.delta.stop_reason;
												} else if (
													data.type === "message_stop" ||
													data.stop_reason
												) {
													finishReason = data.stop_reason || "end_turn";
												} else if (data.delta?.stop_reason) {
													finishReason = data.delta.stop_reason;
												}
												break;
											case "inference.net":
											case "kluster.ai":
											case "together.ai":
											case "groq":
											case "deepseek":
											case "perplexity":
												if (data.choices && data.choices[0]?.finish_reason) {
													finishReason = data.choices[0].finish_reason;
												}
												break;
											default: // OpenAI format
												if (data.choices && data.choices[0]?.finish_reason) {
													finishReason = data.choices[0].finish_reason;
												}
												break;
										}

										// Extract token usage using helper function
										const usage = extractTokenUsage(data, usedProvider);
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
												promptTokens = Math.round(
													messages.reduce(
														(acc, m) => acc + (m.content?.length || 0),
														0,
													) / 4,
												);
											}

											if (!completionTokens) {
												completionTokens =
													estimateTokensFromContent(fullContent);
											}

											totalTokens =
												(promptTokens || 0) + (completionTokens || 0);
										}
									} catch (e) {
										console.warn("Failed to parse streaming JSON:", {
											error: e instanceof Error ? e.message : String(e),
											lineContent: line.substring(0, 100), // First 100 chars for debugging
											provider: usedProvider,
										});
									}
								}
							}
						}
					}
				}
			} catch (error) {
				if (error instanceof Error && error.name === "AbortError") {
					canceled = true;
				} else {
					console.error("Error reading stream:", error);
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

						await stream.writeSSE({
							data: JSON.stringify(finalUsageChunk),
							id: String(eventId++),
						});

						// Send final [DONE] if we haven't already
						await stream.writeSSE({
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
					hasError: false,
					errorDetails: null,
					streamed: true,
					canceled: canceled,
					inputCost: costs.inputCost,
					outputCost: costs.outputCost,
					cachedInputCost: costs.cachedInputCost,
					requestCost: costs.requestCost,
					cost: costs.totalCost,
					estimatedCost: costs.estimatedCost,
					cached: false,
				});
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
		);

		await insertLog({
			...baseLogEntry,
			duration,
			responseSize: errorResponseText.length,
			content: null,
			reasoningContent: null,
			finishReason: getFinishReasonForError(res.status),
			promptTokens: null,
			completionTokens: null,
			totalTokens: null,
			reasoningTokens: null,
			cachedTokens: null,
			hasError: true,
			streamed: false,
			canceled: false,
			errorDetails: {
				statusCode: res.status,
				statusText: res.statusText,
				responseText: errorResponseText,
			},
			cachedInputCost: null,
			requestCost: null,
			estimatedCost: false,
			cached: false,
		});

		// Return a 500 error response
		return c.json(
			{
				error: {
					message: `Error from provider: ${res.status} ${res.statusText}`,
					type: getFinishReasonForError(res.status),
					param: null,
					code: getFinishReasonForError(res.status),
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
		(calculatedPromptTokens || 0) + (calculatedCompletionTokens || 0),
		reasoningTokens,
		cachedTokens,
	);

	if (cachingEnabled && cacheKey && !stream) {
		await setCache(cacheKey, transformedResponse, cacheDuration);
	}

	return c.json(transformedResponse);
});
