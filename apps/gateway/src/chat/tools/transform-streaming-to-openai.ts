import { logger } from "@llmgateway/logger";

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

		case "google-ai-studio":
		case "google-vertex": {
			const mapFinishReason = (
				finishReason?: string,
				hasFunctionCalls?: boolean,
				promptBlockReason?: string,
			): string => {
				if (promptBlockReason) {
					switch (promptBlockReason) {
						case "SAFETY":
						case "PROHIBITED_CONTENT":
						case "BLOCKLIST":
						case "OTHER":
							return "content_filter";
						default:
							return "stop";
					}
				}

				if (!finishReason) {
					return hasFunctionCalls ? "tool_calls" : "stop";
				}

				switch (finishReason) {
					case "STOP":
						return hasFunctionCalls ? "tool_calls" : "stop";
					case "MAX_TOKENS":
						return "length";
					case "MALFORMED_FUNCTION_CALL":
					case "UNEXPECTED_TOOL_CALL":
						return "tool_calls";
					case "SAFETY":
					case "PROHIBITED_CONTENT":
					case "RECITATION":
					case "BLOCKLIST":
					case "SPII":
					case "LANGUAGE":
					case "IMAGE_SAFETY":
					case "IMAGE_PROHIBITED_CONTENT":
					case "NO_IMAGE":
						return "content_filter";
					default:
						return "stop";
				}
			};

			const buildUsage = (
				usageMetadata: any | undefined,
				messagesForFallback: any[],
			) => {
				if (!usageMetadata) {
					return null;
				}

				const promptTokenCount =
					typeof usageMetadata.promptTokenCount === "number" &&
					usageMetadata.promptTokenCount > 0
						? usageMetadata.promptTokenCount
						: calculatePromptTokensFromMessages(messagesForFallback);

				const completionTokenCount = usageMetadata.candidatesTokenCount || 0;

				const reasoningTokenCount = usageMetadata.thoughtsTokenCount || 0;

				const toolUsePromptTokenCount =
					usageMetadata.toolUsePromptTokenCount || 0;

				const totalTokenCount =
					typeof usageMetadata.totalTokenCount === "number" &&
					usageMetadata.totalTokenCount > 0
						? usageMetadata.totalTokenCount
						: promptTokenCount +
							completionTokenCount +
							reasoningTokenCount +
							toolUsePromptTokenCount;

				const usage: any = {
					prompt_tokens: promptTokenCount,
					completion_tokens: completionTokenCount,
					total_tokens: totalTokenCount,
				};

				if (reasoningTokenCount) {
					usage.reasoning_tokens = reasoningTokenCount;
				}

				// I am exposing this google-specific metric under a provider-specific namespace
				// please remove it if you don't need it :)
				usage._provider_google = {
					tool_use_prompt_tokens: toolUsePromptTokenCount,
				};

				return usage;
			};

			const hasCandidatesArray = Array.isArray(data.candidates);
			const firstCandidate = hasCandidatesArray
				? data.candidates[0]
				: undefined;

			if (
				(!data.candidates || data.candidates.length === 0) &&
				!data.promptFeedback?.blockReason
			) {
				logger.error(
					"[transform-streaming-to-openai] Google streaming chunk missing candidates",
					{
						hasCandidates: !!data.candidates,
						candidatesLength: data.candidates?.length || 0,
						hasPromptFeedback: !!data.promptFeedback,
						promptBlockReason: data.promptFeedback?.blockReason,
						dataKeys: Object.keys(data),
					},
				);
			}

			const candidates: any[] = hasCandidatesArray ? data.candidates : [];

			let anyHasContent = false;

			const choices: any[] = candidates.map((candidate, candidateIdx) => {
				const parts: any[] = candidate?.content?.parts || [];

				const textParts = parts.filter(
					(part) => typeof part.text === "string" && !part.thought,
				);
				const thoughtParts = parts.filter(
					(part) => part.thought && typeof part.text === "string",
				);
				const hasImages = parts.some((part) => part.inlineData);
				const hasFunctionCalls = parts.some((part) => part.functionCall);

				const hasThoughtSignature = parts.some(
					(part) => part.thoughtSignature || part.thought_signature,
				);

				const hasAnyContent =
					textParts.length ||
					thoughtParts.length ||
					hasImages ||
					hasFunctionCalls ||
					hasThoughtSignature;

				if (hasAnyContent) {
					anyHasContent = true;
				}

				const delta: StreamingDelta & { provider_extra?: any } = {
					role: "assistant",
				};

				if (textParts.length) {
					delta.content = textParts.map((p) => p.text as string).join("");
				}

				if (thoughtParts.length) {
					delta.reasoning = thoughtParts.map((p) => p.text as string).join("");
				}

				if (hasImages) {
					delta.images = extractImages(data, "google-ai-studio");
				}

				const toolCalls: any[] = [];
				const thoughtSignatures: string[] = [];

				parts.forEach((part, partIndex) => {
					const sig: string | undefined =
						part.thoughtSignature || part.thought_signature;

					if (part.functionCall) {
						const callIndex = toolCalls.length;
						toolCalls.push({
							id: part.functionCall.name + "_" + Date.now() + "_" + callIndex,
							type: "function",
							index: partIndex,
							function: {
								name: part.functionCall.name,
								arguments: JSON.stringify(part.functionCall.args || {}),
							},
							// provider-specific metadata we re-inject the signature later
							// this is following the latest Google tool call schema
							// as long as we need a response, sending back the signature is required
							// it represents the thought process that led to the tool call
							provider_extra: sig
								? {
										google: {
											thought_signature: sig,
										},
									}
								: undefined,
						});
					}

					if (sig) {
						thoughtSignatures.push(sig);
					}
				});

				if (toolCalls.length > 0) {
					(delta as any).tool_calls = toolCalls;
				}

				if (thoughtSignatures.length > 0) {
					delta.provider_extra = {
						...(delta.provider_extra || {}),
						google: {
							...(delta.provider_extra?.google || {}),
							thought_signatures: thoughtSignatures,
						},
					};
				}

				return {
					index:
						typeof candidate.index === "number"
							? candidate.index
							: candidateIdx,
					delta,
					finish_reason: null,
				};
			});

			if (anyHasContent) {
				transformedData = {
					id: data.responseId || `chatcmpl-${Date.now()}`,
					object: "chat.completion.chunk",
					created: Math.floor(Date.now() / 1000),
					model: data.modelVersion || usedModel,
					choices,
					usage: buildUsage(data.usageMetadata, messages),
				};
			} else if (
				data.promptFeedback?.blockReason ||
				firstCandidate?.finishReason
			) {
				const promptBlockReason: string | undefined =
					data.promptFeedback?.blockReason;

				const finishChoices = candidates.length
					? candidates.map((candidate, candidateIdx) => {
							const candidateParts: any[] = candidate?.content?.parts || [];
							const candidateHasFunctionCalls = candidateParts.some(
								(part) => part.functionCall,
							);
							const finishReason = candidate.finishReason as string | undefined;

							return {
								index:
									typeof candidate.index === "number"
										? candidate.index
										: candidateIdx,
								delta: { role: "assistant" },
								finish_reason: mapFinishReason(
									finishReason,
									candidateHasFunctionCalls,
									promptBlockReason,
								),
							};
						})
					: [
							{
								index: 0,
								delta: { role: "assistant" },
								finish_reason: mapFinishReason(
									firstCandidate?.finishReason,
									false,
									promptBlockReason,
								),
							},
						];

				transformedData = {
					id: data.responseId || `chatcmpl-${Date.now()}`,
					object: "chat.completion.chunk",
					created: Math.floor(Date.now() / 1000),
					model: data.modelVersion || usedModel,
					choices: finishChoices,
					usage: buildUsage(data.usageMetadata, messages),
				};
			} else {
				transformedData = {
					id: data.responseId || `chatcmpl-${Date.now()}`,
					object: "chat.completion.chunk",
					created: Math.floor(Date.now() / 1000),
					model: data.modelVersion || usedModel,
					choices: [
						{
							index: firstCandidate?.index || 0,
							delta: { role: "assistant" },
							finish_reason: null,
						},
					],
					usage: buildUsage(data.usageMetadata, messages),
				};
			}

			break;
		}

		case "openai": {
			if (data.type) {
				switch (data.type) {
					case "response.created":
					case "response.in_progress":
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
						const responseUsage = data.response?.usage;
						let usage = null;
						if (responseUsage) {
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
				transformedData = transformOpenaiStreaming(data, usedModel);
			}
			break;
		}

		case "aws-bedrock": {
			const eventType = data.__aws_event_type;

			if (eventType === "contentBlockDelta" && data.delta?.text) {
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
				transformedData = null;
			}
			break;
		}

		default: {
			transformedData = transformOpenaiStreaming(data, usedModel);
			break;
		}
	}

	return transformedData;
}
