import { redisClient } from "@llmgateway/cache";
import { logger } from "@llmgateway/logger";

import { calculatePromptTokensFromMessages } from "./calculate-prompt-tokens.js";
import { extractImages } from "./extract-images.js";
import { adjustGoogleCandidateTokens } from "./extract-token-usage.js";
import { transformOpenaiStreaming } from "./transform-openai-streaming.js";

import type { Annotation, StreamingDelta } from "./types.js";
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
			} else if (
				data.type === "content_block_start" &&
				data.content_block?.type === "web_search_tool_result"
			) {
				// Handle web search tool result start - extract citations
				const webSearchResults = data.content_block?.content || [];
				const annotations: Annotation[] = [];
				for (const result of webSearchResults) {
					if (result.type === "web_search_result") {
						annotations.push({
							type: "url_citation",
							url_citation: {
								url: result.url || "",
								title: result.title,
							},
						});
					}
				}
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
								...(annotations.length > 0 && { annotations }),
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
				logger.warn("[streaming] Unrecognized Anthropic chunk", {
					provider: usedProvider,
					model: usedModel,
					type: data.type,
					deltaType: data.delta?.type,
					dataKeys: Object.keys(data),
				});
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
		case "google-vertex":
		case "obsidian": {
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

				const rawCandidates = usageMetadata.candidatesTokenCount || 0;

				const reasoningTokenCount = usageMetadata.thoughtsTokenCount || 0;

				// Adjust for inconsistent Google API behavior where
				// candidatesTokenCount may already include thoughtsTokenCount
				const adjustedCandidates = adjustGoogleCandidateTokens(
					rawCandidates,
					reasoningTokenCount,
					promptTokenCount,
					usageMetadata.totalTokenCount,
				);

				// completionTokenCount includes reasoning for correct totals
				const completionTokenCount = adjustedCandidates + reasoningTokenCount;

				const toolUsePromptTokenCount =
					usageMetadata.toolUsePromptTokenCount || 0;

				// Extract cached tokens from Google's implicit caching
				const cachedContentTokenCount =
					usageMetadata.cachedContentTokenCount || 0;

				const totalTokenCount =
					promptTokenCount + completionTokenCount + toolUsePromptTokenCount;

				const usage: any = {
					prompt_tokens: promptTokenCount,
					completion_tokens: completionTokenCount,
					total_tokens: totalTokenCount,
				};

				if (reasoningTokenCount) {
					usage.reasoning_tokens = reasoningTokenCount;
				}

				// Include cached tokens in OpenAI-compatible format
				if (cachedContentTokenCount > 0) {
					usage.prompt_tokens_details = {
						cached_tokens: cachedContentTokenCount,
					};
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

					// Check for unrecognized part types
					const isKnownPartType =
						typeof part.text === "string" ||
						part.functionCall ||
						part.inlineData ||
						part.thoughtSignature ||
						part.thought_signature;

					if (!isKnownPartType) {
						logger.warn("[streaming] Unrecognized Google part type", {
							provider: usedProvider,
							model: usedModel,
							partIndex,
							partKeys: Object.keys(part),
						});
					}

					if (part.functionCall) {
						const callIndex = toolCalls.length;
						const toolCallId =
							part.functionCall.name + "_" + Date.now() + "_" + callIndex;
						toolCalls.push({
							id: toolCallId,
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

						// Cache thoughtSignature in Redis for server-side retrieval in multi-turn conversations
						// This is especially important when OpenAI SDKs don't preserve extra_content/provider_extra
						if (sig) {
							redisClient
								.setex(
									`thought_signature:${toolCallId}`,
									86400, // 1 day expiration
									sig,
								)
								.catch((err) => {
									logger.error(
										"Failed to cache thought_signature in streaming transform",
										{ err },
									);
								});
						}
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

				// Extract grounding metadata citations for web search
				const groundingMetadata = candidate.groundingMetadata;
				if (groundingMetadata?.groundingChunks) {
					const annotationsList: Annotation[] = [];
					for (const chunk of groundingMetadata.groundingChunks) {
						if (chunk.web) {
							annotationsList.push({
								type: "url_citation",
								url_citation: {
									url: chunk.web.uri || "",
									title: chunk.web.title,
								},
							});
						}
					}
					if (annotationsList.length > 0) {
						delta.annotations = annotationsList;
					}
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
				logger.warn("[streaming] Google chunk with no content", {
					provider: usedProvider,
					model: usedModel,
					hasCandidates: hasCandidatesArray,
					candidatesCount: candidates.length,
					firstCandidateKeys: firstCandidate ? Object.keys(firstCandidate) : [],
					hasContentParts: !!(firstCandidate?.content?.parts?.length > 0),
					partsCount: firstCandidate?.content?.parts?.length ?? 0,
					hasUsageMetadata: !!data.usageMetadata,
					dataKeys: Object.keys(data),
				});
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
				// Log full OpenAI event data for debugging
				logger.info("[OpenAI Streaming Debug]", {
					eventType: data.type,
					hasAnnotations: !!(data.annotations || data.part?.annotations),
					annotationsCount: (data.annotations || data.part?.annotations || [])
						.length,
					hasDelta: !!data.delta,
					deltaKeys: data.delta ? Object.keys(data.delta) : [],
					fullData: JSON.stringify(data),
				});

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

					case "response.output_item.added": {
						// Check if this is a function_call item
						const item = data.item;
						if (item?.type === "function_call") {
							// First chunk for function call - emit id, type, name
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
											tool_calls: [
												{
													index: data.output_index || 0,
													id: item.call_id || `call_${Date.now()}`,
													type: "function",
													function: {
														name: item.name || "",
														arguments: "",
													},
												},
											],
											role: "assistant",
										},
										finish_reason: null,
									},
								],
								usage: null,
							};
						} else {
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
						}
						break;
					}
					case "response.output_item.done":
					case "response.web_search_call.in_progress":
					case "response.web_search_call.searching":
					case "response.web_search_call.completed":
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

					case "response.function_call_arguments.delta":
						// Streaming function call arguments from Responses API
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
										tool_calls: [
											{
												index: data.output_index || 0,
												function: {
													arguments: data.delta || "",
												},
											},
										],
										role: "assistant",
									},
									finish_reason: null,
								},
							],
							usage: null,
						};
						break;

					case "response.function_call_arguments.done":
						// Function call arguments complete - just emit empty delta
						// (id/type/name already sent in output_item.added, args sent in deltas)
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

					case "response.output_item.annotations.added":
					case "response.content_part.annotations.added": {
						// Handle web search annotations/citations from OpenAI Responses API
						const annotations =
							data.annotations || data.part?.annotations || [];
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
										...(annotations.length > 0 && { annotations }),
									},
									finish_reason: null,
								},
							],
							usage: null,
						};
						break;
					}

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
						logger.warn("[streaming] Unrecognized OpenAI event type", {
							provider: usedProvider,
							model: usedModel,
							eventType: data.type,
							dataKeys: Object.keys(data),
						});
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
				// Log standard OpenAI streaming format for debugging
				logger.info("[OpenAI Standard Streaming Debug]", {
					hasChoices: !!data.choices,
					choicesLength: data.choices?.length || 0,
					firstChoiceDeltaKeys: data.choices?.[0]?.delta
						? Object.keys(data.choices[0].delta)
						: [],
					hasAnnotations: !!data.choices?.[0]?.delta?.annotations,
					annotationsCount: data.choices?.[0]?.delta?.annotations?.length || 0,
					fullData: JSON.stringify(data),
				});

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
			} else if (eventType === "contentBlockStart" && data.start?.toolUse) {
				// Tool use start event contains the tool id and name
				const toolUse = data.start.toolUse;
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
											arguments: "",
										},
									},
								],
								role: "assistant",
							},
							finish_reason: null,
						},
					],
				};
			} else if (eventType === "contentBlockDelta" && data.delta?.toolUse) {
				// Tool use delta event contains partial JSON arguments
				// Per OpenAI spec, subsequent chunks omit id/type/name - only index and arguments
				const toolUse = data.delta.toolUse;
				// toolUse.input is a string (partial JSON), not an object
				const args =
					typeof toolUse.input === "string"
						? toolUse.input
						: JSON.stringify(toolUse.input || {});
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
										function: {
											arguments: args,
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
				logger.warn("[streaming] Unrecognized AWS Bedrock event type", {
					provider: usedProvider,
					model: usedModel,
					eventType,
					dataKeys: Object.keys(data),
				});
				transformedData = null;
			}
			break;
		}

		case "mistral":
		case "novita":
		case "routeway":
		case "zai": {
			// Transform standard OpenAI streaming format with finish reason mapping
			transformedData = transformOpenaiStreaming(data, usedModel);

			// Map non-standard finish reasons to OpenAI-compatible values
			if (transformedData?.choices?.[0]?.finish_reason === "end_turn") {
				transformedData.choices[0].finish_reason = "stop";
			} else if (transformedData?.choices?.[0]?.finish_reason === "tool_use") {
				transformedData.choices[0].finish_reason = "tool_calls";
			}
			break;
		}

		default: {
			logger.warn("[streaming] Unknown provider using OpenAI fallback", {
				provider: usedProvider,
				model: usedModel,
				dataKeys: Object.keys(data),
			});
			transformedData = transformOpenaiStreaming(data, usedModel);
			break;
		}
	}

	return transformedData;
}
