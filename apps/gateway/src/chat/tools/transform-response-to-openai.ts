import type { ImageObject } from "./types.js";
import type { Provider } from "@llmgateway/models";

/**
 * Transforms response to OpenAI format for non-OpenAI providers
 */
export function transformResponseToOpenai(
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
	images: ImageObject[],
	requestedModel: string,
	requestedProvider: string | null,
	baseModelName: string,
) {
	let transformedResponse = json;

	switch (usedProvider) {
		case "google-ai-studio": {
			transformedResponse = {
				id: `chatcmpl-${Date.now()}`,
				object: "chat.completion",
				created: Math.floor(Date.now() / 1000),
				model: `${usedProvider}/${baseModelName}`,
				choices: [
					{
						index: 0,
						message: {
							role: "assistant",
							content: content,
							...(reasoningContent !== null && {
								reasoning: reasoningContent,
							}),
							...(toolResults && { tool_calls: toolResults }),
							...(images && images.length > 0 && { images }),
						},
						finish_reason: finishReason || "stop",
					},
				],
				usage: {
					prompt_tokens: Math.max(1, promptTokens || 1),
					completion_tokens: completionTokens || 0,
					total_tokens: (() => {
						const fallbackTotal =
							(promptTokens || 0) +
							(completionTokens || 0) +
							(reasoningTokens || 0);
						return Math.max(1, totalTokens ?? fallbackTotal);
					})(),
					...(reasoningTokens !== null && {
						reasoning_tokens: reasoningTokens,
					}),
					...(cachedTokens !== null && {
						prompt_tokens_details: {
							cached_tokens: cachedTokens,
						},
					}),
				},
				metadata: {
					requested_model: requestedModel,
					requested_provider: requestedProvider,
					used_model: baseModelName,
					used_provider: usedProvider,
					underlying_used_model: usedModel,
				},
			};
			break;
		}
		case "anthropic": {
			transformedResponse = {
				id: `chatcmpl-${Date.now()}`,
				object: "chat.completion",
				created: Math.floor(Date.now() / 1000),
				model: `${usedProvider}/${baseModelName}`,
				choices: [
					{
						index: 0,
						message: {
							role: "assistant",
							content: content,
							...(reasoningContent !== null && {
								reasoning: reasoningContent,
							}),
							...(toolResults && { tool_calls: toolResults }),
						},
						finish_reason:
							finishReason === "end_turn"
								? "stop"
								: finishReason === "tool_use"
									? "tool_calls"
									: finishReason === "max_tokens"
										? "length"
										: "stop",
					},
				],
				usage: {
					prompt_tokens: Math.max(1, promptTokens || 1),
					completion_tokens: completionTokens || 0,
					total_tokens: (() => {
						const fallbackTotal =
							(promptTokens || 0) +
							(completionTokens || 0) +
							(reasoningTokens || 0);
						return Math.max(1, totalTokens ?? fallbackTotal);
					})(),
					...(reasoningTokens !== null && {
						reasoning_tokens: reasoningTokens,
					}),
					...(cachedTokens !== null && {
						prompt_tokens_details: {
							cached_tokens: cachedTokens,
						},
					}),
				},
				metadata: {
					requested_model: requestedModel,
					requested_provider: requestedProvider,
					used_model: baseModelName,
					used_provider: usedProvider,
					underlying_used_model: usedModel,
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
					model: `${usedProvider}/${baseModelName}`,
					choices: [
						{
							index: 0,
							message: {
								role: "assistant",
								content: content,
								...(reasoningContent !== null && {
									reasoning: reasoningContent,
								}),
							},
							finish_reason: finishReason || "stop",
						},
					],
					usage: {
						prompt_tokens: Math.max(1, promptTokens || 1),
						completion_tokens: completionTokens || 0,
						total_tokens: (() => {
							const fallbackTotal =
								(promptTokens || 0) +
								(completionTokens || 0) +
								(reasoningTokens || 0);
							return Math.max(1, totalTokens ?? fallbackTotal);
						})(),
						...(reasoningTokens !== null && {
							reasoning_tokens: reasoningTokens,
						}),
					},
					metadata: {
						requested_model: requestedModel,
						requested_provider: requestedProvider,
						used_model: baseModelName,
						used_provider: usedProvider,
						underlying_used_model: usedModel,
					},
				};
			} else {
				// Ensure reasoning field is present if we have reasoning content
				if (transformedResponse.choices?.[0]?.message) {
					const message = transformedResponse.choices[0].message;
					if (reasoningContent !== null) {
						message.reasoning = reasoningContent;
						// Remove the old reasoning_content field if it exists
						delete message.reasoning_content;
					}
				}
				// Add metadata to existing response
				transformedResponse.model = `${usedProvider}/${baseModelName}`;
				transformedResponse.metadata = {
					requested_model: requestedModel,
					requested_provider: requestedProvider,
					used_model: baseModelName,
					used_provider: usedProvider,
					underlying_used_model: usedModel,
				};
			}
			break;
		}
		case "aws-bedrock": {
			transformedResponse = {
				id: `chatcmpl-${Date.now()}`,
				object: "chat.completion",
				created: Math.floor(Date.now() / 1000),
				model: `${usedProvider}/${baseModelName}`,
				choices: [
					{
						index: 0,
						message: {
							role: "assistant",
							content: content,
							...(reasoningContent !== null && {
								reasoning: reasoningContent,
							}),
							...(toolResults && { tool_calls: toolResults }),
						},
						finish_reason: finishReason || "stop",
					},
				],
				usage: {
					prompt_tokens: Math.max(1, promptTokens || 1),
					completion_tokens: completionTokens || 0,
					total_tokens: (() => {
						const fallbackTotal =
							(promptTokens || 0) +
							(completionTokens || 0) +
							(reasoningTokens || 0);
						return Math.max(1, totalTokens ?? fallbackTotal);
					})(),
					...(reasoningTokens !== null && {
						reasoning_tokens: reasoningTokens,
					}),
					...(cachedTokens !== null && {
						prompt_tokens_details: {
							cached_tokens: cachedTokens,
						},
					}),
				},
				metadata: {
					requested_model: requestedModel,
					requested_provider: requestedProvider,
					used_model: baseModelName,
					used_provider: usedProvider,
					underlying_used_model: usedModel,
				},
			};
			break;
		}
		case "openai": {
			// Handle OpenAI responses format transformation to chat completions format
			if (json.output && Array.isArray(json.output)) {
				// This is from the responses endpoint - transform to chat completions format
				transformedResponse = {
					id: json.id || `chatcmpl-${Date.now()}`,
					object: "chat.completion",
					created: json.created_at || Math.floor(Date.now() / 1000),
					model: `${usedProvider}/${baseModelName}`,
					choices: [
						{
							index: 0,
							message: {
								role: "assistant",
								content: content,
								...(reasoningContent !== null && {
									reasoning: reasoningContent,
								}),
								...(toolResults && { tool_calls: toolResults }),
							},
							finish_reason: finishReason || "stop",
						},
					],
					usage: {
						prompt_tokens: Math.max(1, promptTokens || 1),
						completion_tokens: completionTokens || 0,
						total_tokens: (() => {
							const fallbackTotal =
								(promptTokens || 0) +
								(completionTokens || 0) +
								(reasoningTokens || 0);
							return Math.max(1, totalTokens ?? fallbackTotal);
						})(),
						...(reasoningTokens !== null && {
							reasoning_tokens: reasoningTokens,
						}),
						...(cachedTokens !== null && {
							prompt_tokens_details: {
								cached_tokens: cachedTokens,
							},
						}),
					},
					metadata: {
						requested_model: requestedModel,
						requested_provider: requestedProvider,
						used_model: baseModelName,
						used_provider: usedProvider,
						underlying_used_model: usedModel,
					},
				};
			} else {
				// For standard chat completions format, update model field and add metadata
				if (transformedResponse && typeof transformedResponse === "object") {
					transformedResponse.model = `${usedProvider}/${baseModelName}`;
					transformedResponse.metadata = {
						requested_model: requestedModel,
						requested_provider: requestedProvider,
						used_model: baseModelName,
						used_provider: usedProvider,
						underlying_used_model: usedModel,
					};
				}
			}
			break;
		}
		default: {
			// For any other provider, add metadata to existing response
			if (transformedResponse && typeof transformedResponse === "object") {
				// Ensure reasoning field is present if we have reasoning content
				if (transformedResponse.choices?.[0]?.message) {
					const message = transformedResponse.choices[0].message;
					if (reasoningContent !== null) {
						message.reasoning = reasoningContent;
						// Remove the old reasoning_content field if it exists
						delete message.reasoning_content;
					}
				}
				transformedResponse.model = `${usedProvider}/${baseModelName}`;
				transformedResponse.metadata = {
					requested_model: requestedModel,
					requested_provider: requestedProvider,
					used_model: baseModelName,
					used_provider: usedProvider,
					underlying_used_model: usedModel,
				};
			}
			break;
		}
	}

	return transformedResponse;
}
