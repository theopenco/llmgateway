import { calculatePromptTokensFromMessages } from "./calculate-prompt-tokens.js";
import { extractImages } from "./extract-images.js";
import { transformOpenaiStreaming } from "./transform-openai-streaming.js";

import type { StreamingDelta } from "./types.js";
import type { Provider } from "@llmgateway/models";

export function transformStreamingToOpenai(
	usedProvider: Provider,
	usedModel: string,
	data: any,
	messages: any[],
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
				data.type === "content_block_delta" &&
				data.delta?.type === "thinking_delta" &&
				data.delta?.thinking
			) {
				// Handle thinking content delta - convert to unified reasoning format
				transformedData = {
					id: data.id || `chatcmpl-${Date.now()}`,
					object: "chat.completion.chunk",
					created: data.created || Math.floor(Date.now() / 1000),
					model: data.model || usedModel,
					choices: [
						{
							index: 0,
							delta: {
								reasoning: data.delta.thinking,
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
										: stopReason === "max_tokens"
											? "length"
											: "stop",
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
										: stopReason === "max_tokens"
											? "length"
											: "stop",
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
		case "google-ai-studio": {
			const parts = data.candidates?.[0]?.content?.parts || [];
			const hasText = parts.some((part: any) => part.text && !part.thought);
			const hasThought = parts.some((part: any) => part.thought && part.text);
			const hasImages = parts.some((part: any) => part.inlineData);
			const hasFunctionCalls = parts.some((part: any) => part.functionCall);

			if (hasText || hasThought || hasImages || hasFunctionCalls) {
				const delta: StreamingDelta = {
					role: "assistant",
				};

				// Add text content if present (excluding thoughts)
				if (hasText) {
					delta.content =
						parts
							.filter((part: any) => !part.thought)
							.map((part: any) =>
								typeof part.text === "string" ? part.text : "",
							)
							.join("") || "";
				}

				// Add thinking/reasoning content if present
				if (hasThought) {
					delta.reasoning =
						parts
							.filter((part: any) => part.thought)
							.map((part: any) =>
								typeof part.text === "string" ? part.text : "",
							)
							.join("") || "";
				}

				// Add images if present
				if (hasImages) {
					delta.images = extractImages(data, "google-ai-studio");
				}

				// Emit tool_calls if present
				if (hasFunctionCalls) {
					const toolCalls = parts
						.filter((part: any) => part.functionCall)
						.map((part: any, index: number) => ({
							id: part.functionCall.name + "_" + Date.now() + "_" + index,
							type: "function",
							index: index,
							function: {
								name: part.functionCall.name,
								arguments: JSON.stringify(part.functionCall.args || {}),
							},
						}));
					if (toolCalls.length > 0) {
						delta.tool_calls = toolCalls;
					}
				}

				transformedData = {
					id: data.responseId || `chatcmpl-${Date.now()}`,
					object: "chat.completion.chunk",
					created: Math.floor(Date.now() / 1000),
					model: data.modelVersion || usedModel,
					choices: [
						{
							index: data.candidates[0].index || 0,
							delta,
							finish_reason: null,
						},
					],
					usage: data.usageMetadata
						? {
								prompt_tokens:
									data.usageMetadata.promptTokenCount > 0
										? data.usageMetadata.promptTokenCount
										: calculatePromptTokensFromMessages(messages),
								completion_tokens: data.usageMetadata.candidatesTokenCount || 0,
								// Calculate total including reasoning tokens for Google models
								total_tokens:
									(data.usageMetadata.promptTokenCount > 0
										? data.usageMetadata.promptTokenCount
										: calculatePromptTokensFromMessages(messages)) +
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
									: finishReason === "MAX_TOKENS"
										? "length"
										: finishReason === "SAFETY"
											? "content_filter"
											: "stop",
						},
					],
					usage: data.usageMetadata
						? {
								prompt_tokens:
									data.usageMetadata.promptTokenCount > 0
										? data.usageMetadata.promptTokenCount
										: calculatePromptTokensFromMessages(messages),
								completion_tokens: data.usageMetadata.candidatesTokenCount || 0,
								// Calculate total including reasoning tokens for Google models
								total_tokens:
									(data.usageMetadata.promptTokenCount > 0
										? data.usageMetadata.promptTokenCount
										: calculatePromptTokensFromMessages(messages)) +
									(data.usageMetadata.candidatesTokenCount || 0) +
									(data.usageMetadata.thoughtsTokenCount || 0),
								...(data.usageMetadata.thoughtsTokenCount && {
									reasoning_tokens: data.usageMetadata.thoughtsTokenCount,
								}),
							}
						: null,
				};
			} else {
				// Handle any other Google chunks that don't have content or finishReason
				// but still need to be in proper OpenAI format
				transformedData = {
					id: data.responseId || `chatcmpl-${Date.now()}`,
					object: "chat.completion.chunk",
					created: Math.floor(Date.now() / 1000),
					model: data.modelVersion || usedModel,
					choices: [
						{
							index: data.candidates?.[0]?.index || 0,
							delta: {},
							finish_reason: null,
						},
					],
					usage: data.usageMetadata
						? {
								prompt_tokens:
									data.usageMetadata.promptTokenCount > 0
										? data.usageMetadata.promptTokenCount
										: calculatePromptTokensFromMessages(messages),
								completion_tokens: data.usageMetadata.candidatesTokenCount || 0,
								// Calculate total including reasoning tokens for Google models
								total_tokens:
									(data.usageMetadata.promptTokenCount > 0
										? data.usageMetadata.promptTokenCount
										: calculatePromptTokensFromMessages(messages)) +
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
		case "openai": {
			// Handle OpenAI responses API streaming format (event-based)
			if (data.type) {
				// Handle different OpenAI responses streaming event types
				switch (data.type) {
					case "response.created":
					case "response.in_progress":
						// Initial/progress events - return empty delta to maintain stream
						transformedData = {
							id: data.response?.id || `chatcmpl-${Date.now()}`,
							object: "chat.completion.chunk",
							created:
								data.response?.created_at || Math.floor(Date.now() / 1000),
							model: data.response?.model || usedModel,
							choices: [
								{
									index: 0,
									delta: { role: "assistant" },
									finish_reason: null,
								},
							],
							usage: null,
						};
						break;

					case "response.output_item.added":
						// New output item added (reasoning or message) - return empty delta
						transformedData = {
							id: data.response?.id || `chatcmpl-${Date.now()}`,
							object: "chat.completion.chunk",
							created:
								data.response?.created_at || Math.floor(Date.now() / 1000),
							model: data.response?.model || usedModel,
							choices: [
								{
									index: 0,
									delta: { role: "assistant" },
									finish_reason: null,
								},
							],
							usage: null,
						};
						break;

					case "response.reasoning_summary_part.added":
					case "response.reasoning_summary_text.delta":
						// Reasoning content delta
						transformedData = {
							id: data.response?.id || `chatcmpl-${Date.now()}`,
							object: "chat.completion.chunk",
							created:
								data.response?.created_at || Math.floor(Date.now() / 1000),
							model: data.response?.model || usedModel,
							choices: [
								{
									index: 0,
									delta: {
										role: "assistant",
										reasoning: data.delta || data.part?.text || "",
									},
									finish_reason: null,
								},
							],
							usage: null,
						};
						break;

					case "response.content_part.added":
					case "response.output_text.delta":
					case "response.text.delta":
						// Message content delta
						transformedData = {
							id: data.response?.id || `chatcmpl-${Date.now()}`,
							object: "chat.completion.chunk",
							created:
								data.response?.created_at || Math.floor(Date.now() / 1000),
							model: data.response?.model || usedModel,
							choices: [
								{
									index: 0,
									delta: {
										role: "assistant",
										content: data.delta || data.part?.text || "",
									},
									finish_reason: null,
								},
							],
							usage: null,
						};
						break;

					case "response.completed": {
						// Final completion event with usage data
						const responseUsage = data.response?.usage;
						let usage = null;
						if (responseUsage) {
							// Map OpenAI responses usage format to chat completions format
							usage = {
								prompt_tokens: responseUsage.input_tokens || 0,
								completion_tokens: responseUsage.output_tokens || 0,
								total_tokens: responseUsage.total_tokens || 0,
								...(responseUsage.output_tokens_details?.reasoning_tokens && {
									reasoning_tokens:
										responseUsage.output_tokens_details.reasoning_tokens,
								}),
								...(responseUsage.input_tokens_details?.cached_tokens && {
									prompt_tokens_details: {
										cached_tokens:
											responseUsage.input_tokens_details.cached_tokens,
									},
								}),
							};
						}
						transformedData = {
							id: data.response?.id || `chatcmpl-${Date.now()}`,
							object: "chat.completion.chunk",
							created:
								data.response?.created_at || Math.floor(Date.now() / 1000),
							model: data.response?.model || usedModel,
							choices: [
								{
									index: 0,
									delta: {},
									finish_reason: "stop",
								},
							],
							usage,
						};
						break;
					}

					default:
						// Unknown event type - still provide basic OpenAI format structure
						transformedData = {
							id: data.response?.id || `chatcmpl-${Date.now()}`,
							object: "chat.completion.chunk",
							created:
								data.response?.created_at || Math.floor(Date.now() / 1000),
							model: data.response?.model || usedModel,
							choices: [
								{
									index: 0,
									delta: { role: "assistant" },
									finish_reason: null,
								},
							],
							usage: null,
						};
						break;
				}
			} else {
				// If not responses format, handle as regular OpenAI streaming
				transformedData = transformOpenaiStreaming(data, usedModel);
			}
			break;
		}
		case "aws-bedrock": {
			// AWS Bedrock Converse Stream API format
			// The event type is in __aws_event_type field added by the parser
			const eventType = data.__aws_event_type;

			if (eventType === "contentBlockDelta" && data.delta?.text) {
				// Text content delta
				transformedData = {
					id: `chatcmpl-${Date.now()}`,
					object: "chat.completion.chunk",
					created: Math.floor(Date.now() / 1000),
					model: usedModel,
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
				};
			} else if (eventType === "contentBlockDelta" && data.delta?.toolUse) {
				// Tool use delta
				const toolUse = data.delta.toolUse;
				transformedData = {
					id: `chatcmpl-${Date.now()}`,
					object: "chat.completion.chunk",
					created: Math.floor(Date.now() / 1000),
					model: usedModel,
					choices: [
						{
							index: 0,
							delta: {
								tool_calls: [
									{
										index: data.contentBlockIndex || 0,
										id: toolUse.toolUseId,
										type: "function",
										function: {
											name: toolUse.name,
											arguments: JSON.stringify(toolUse.input || {}),
										},
									},
								],
								role: "assistant",
							},
							finish_reason: null,
						},
					],
				};
			} else if (eventType === "messageStart") {
				// Message start - send initial chunk with role
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
							finish_reason: null,
						},
					],
				};
			} else if (eventType === "messageStop") {
				// Message stop event with finish reason
				const stopReason = data.stopReason;
				let finishReason = "stop";
				if (stopReason === "max_tokens") {
					finishReason = "length";
				} else if (stopReason === "tool_use") {
					finishReason = "tool_calls";
				} else if (stopReason === "content_filtered") {
					finishReason = "content_filter";
				}

				transformedData = {
					id: `chatcmpl-${Date.now()}`,
					object: "chat.completion.chunk",
					created: Math.floor(Date.now() / 1000),
					model: usedModel,
					choices: [
						{
							index: 0,
							delta: {},
							finish_reason: finishReason,
						},
					],
				};
			} else if (eventType === "metadata" && data.usage) {
				// Usage metadata event
				transformedData = {
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
						prompt_tokens: data.usage.inputTokens || 0,
						completion_tokens: data.usage.outputTokens || 0,
						total_tokens: data.usage.totalTokens || 0,
					},
				};
			} else {
				// For other event types (e.g., contentBlockStop), return null to skip
				transformedData = null;
			}
			break;
		}
		// OpenAI and other providers that already use OpenAI format
		default: {
			transformedData = transformOpenaiStreaming(data, usedModel);
			break;
		}
	}

	return transformedData;
}
