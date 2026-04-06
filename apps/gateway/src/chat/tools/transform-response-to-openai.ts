import type { RoutingAttempt } from "./retry-with-fallback.js";
import type { Annotation, ImageObject } from "./types.js";
import type { Provider } from "@llmgateway/models";

export interface CostData {
	inputCost: number | null;
	outputCost: number | null;
	cachedInputCost: number | null;
	requestCost: number | null;
	webSearchCost: number | null;
	imageInputCost: number | null;
	imageOutputCost: number | null;
	totalCost: number | null;
}

function buildMetadata(
	requestedModel: string,
	requestedProvider: string | null,
	baseModelName: string,
	usedProvider: Provider,
	usedModel: string,
	requestId: string,
	routing: RoutingAttempt[] | null,
	usedRegion?: string,
) {
	return {
		request_id: requestId,
		requested_model: requestedModel,
		requested_provider: requestedProvider,
		used_model: baseModelName,
		used_provider: usedProvider,
		...(usedRegion && { used_region: usedRegion }),
		underlying_used_model: usedModel,
		...(routing && { routing }),
	};
}

function sanitizeRoutingAttempts(
	routing: RoutingAttempt[] | null | undefined,
): RoutingAttempt[] | undefined {
	if (!routing) {
		return undefined;
	}

	return routing.map(
		({ apiKeyHash: _apiKeyHash, logId: _logId, ...attempt }) => ({
			...attempt,
		}),
	);
}

export function stripRequestScopedMetadataFromOpenAiResponse<
	T extends {
		metadata?: Record<string, unknown> | null;
	},
>(response: T): T {
	const metadata = response.metadata;
	if (!metadata || typeof metadata !== "object") {
		return response;
	}

	const nextMetadata = { ...metadata };
	delete nextMetadata.request_id;

	if (Array.isArray(metadata.routing)) {
		nextMetadata.routing = sanitizeRoutingAttempts(
			metadata.routing as RoutingAttempt[],
		);
	}

	return {
		...response,
		metadata: nextMetadata,
	};
}

export function withCurrentRequestMetadataOnOpenAiResponse<
	T extends {
		metadata?: Record<string, unknown> | null;
	},
>(response: T, requestId: string): T {
	const sanitizedResponse =
		stripRequestScopedMetadataFromOpenAiResponse(response);
	const metadata = sanitizedResponse.metadata;

	if (!metadata || typeof metadata !== "object") {
		return sanitizedResponse;
	}

	return {
		...sanitizedResponse,
		metadata: {
			...metadata,
			request_id: requestId,
		},
	};
}

/**
 * Helper function to build usage object with optional cost fields
 */
function buildUsageObject(
	promptTokens: number | null,
	completionTokens: number | null,
	totalTokens: number | null,
	reasoningTokens: number | null,
	cachedTokens: number | null,
	costs: CostData | null,
	showUpgradeMessage = false,
) {
	return {
		prompt_tokens: Math.max(1, promptTokens ?? 1),
		completion_tokens: completionTokens ?? 0,
		total_tokens: (() => {
			const fallbackTotal =
				(promptTokens ?? 0) + (completionTokens ?? 0) + (reasoningTokens ?? 0);
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
		...(costs !== null && {
			cost_usd_total: costs.totalCost,
			cost_usd_input: costs.inputCost,
			cost_usd_output: costs.outputCost,
			cost_usd_cached_input: costs.cachedInputCost,
			cost_usd_request: costs.requestCost,
			cost_usd_web_search: costs.webSearchCost,
			cost_usd_image_input: costs.imageInputCost,
			cost_usd_image_output: costs.imageOutputCost,
		}),
		...(showUpgradeMessage && {
			info: "upgrade to pro to include usd cost breakdown",
		}),
	};
}

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
	costs: CostData | null = null,
	showUpgradeMessage = false,
	annotations: Annotation[] | null = null,
	routing: RoutingAttempt[] | null = null,
	requestId = "",
	usedRegion?: string | undefined,
) {
	let transformedResponse = json;

	switch (usedProvider) {
		case "google-ai-studio":
		case "glacier":
		case "google-vertex":
		case "quartz":
		case "obsidian": {
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
							...(annotations && annotations.length > 0 && { annotations }),
						},
						finish_reason: (() => {
							// Map Google finish reasons to OpenAI format for the response
							if (!finishReason) {
								return "stop";
							}
							if (finishReason === "STOP") {
								return toolResults ? "tool_calls" : "stop";
							}
							if (finishReason === "MAX_TOKENS") {
								return "length";
							}
							if (
								finishReason === "SAFETY" ||
								finishReason === "PROHIBITED_CONTENT" ||
								finishReason === "RECITATION" ||
								finishReason === "BLOCKLIST" ||
								finishReason === "SPII"
							) {
								return "content_filter";
							}
							return "stop";
						})(),
					},
				],
				usage: buildUsageObject(
					promptTokens,
					completionTokens,
					totalTokens,
					reasoningTokens,
					cachedTokens,
					costs,
					showUpgradeMessage,
				),
				metadata: buildMetadata(
					requestedModel,
					requestedProvider,
					baseModelName,
					usedProvider,
					usedModel,
					requestId,
					routing,
					usedRegion,
				),
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
							...(annotations && annotations.length > 0 && { annotations }),
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
				usage: buildUsageObject(
					promptTokens,
					completionTokens,
					totalTokens,
					reasoningTokens,
					cachedTokens,
					costs,
					showUpgradeMessage,
				),
				metadata: buildMetadata(
					requestedModel,
					requestedProvider,
					baseModelName,
					usedProvider,
					usedModel,
					requestId,
					routing,
					usedRegion,
				),
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
							finish_reason: finishReason ?? "stop",
						},
					],
					usage: buildUsageObject(
						promptTokens,
						completionTokens,
						totalTokens,
						reasoningTokens,
						cachedTokens,
						costs,
						showUpgradeMessage,
					),
					metadata: buildMetadata(
						requestedModel,
						requestedProvider,
						baseModelName,
						usedProvider,
						usedModel,
						requestId,
						routing,
					),
				};
			} else {
				// Ensure reasoning field is present if we have reasoning content
				// Also update content and finish_reason with parsed values
				if (transformedResponse.choices?.[0]?.message) {
					const message = transformedResponse.choices[0].message;
					// Update content with parsed content (handles JSON unwrapping for Mistral/Novita)
					if (content !== null) {
						message.content = content;
					}
					if (reasoningContent !== null) {
						message.reasoning = reasoningContent;
						// Remove the old reasoning_content field if it exists
						delete message.reasoning_content;
					}
				}
				// Update finish_reason with the mapped value
				if (transformedResponse.choices?.[0] && finishReason !== null) {
					transformedResponse.choices[0].finish_reason = finishReason;
				}
				// Add metadata and usage with costs to existing response
				transformedResponse.model = `${usedProvider}/${baseModelName}`;
				transformedResponse.metadata = buildMetadata(
					requestedModel,
					requestedProvider,
					baseModelName,
					usedProvider,
					usedModel,
					requestId,
					routing,
					usedRegion,
				);
				if (transformedResponse.usage) {
					if (costs !== null) {
						transformedResponse.usage = {
							...transformedResponse.usage,
							cost_usd_total: costs.totalCost,
							cost_usd_input: costs.inputCost,
							cost_usd_output: costs.outputCost,
							cost_usd_cached_input: costs.cachedInputCost,
							cost_usd_request: costs.requestCost,
							cost_usd_image_input: costs.imageInputCost,
							cost_usd_image_output: costs.imageOutputCost,
						};
					}
					if (showUpgradeMessage) {
						transformedResponse.usage = {
							...transformedResponse.usage,
							info: "upgrade to pro to include usd cost breakdown",
						};
					}
				}
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
							...(annotations && annotations.length > 0 && { annotations }),
						},
						finish_reason: finishReason ?? "stop",
					},
				],
				usage: buildUsageObject(
					promptTokens,
					completionTokens,
					totalTokens,
					reasoningTokens,
					cachedTokens,
					costs,
					showUpgradeMessage,
				),
				metadata: buildMetadata(
					requestedModel,
					requestedProvider,
					baseModelName,
					usedProvider,
					usedModel,
					requestId,
					routing,
					usedRegion,
				),
			};
			break;
		}
		case "alibaba": {
			// Check if this is a DashScope multimodal generation response (image generation)
			// These have output.choices format instead of direct choices
			if (json.output?.choices) {
				transformedResponse = {
					id: json.request_id ?? `chatcmpl-${Date.now()}`,
					object: "chat.completion",
					created: Math.floor(Date.now() / 1000),
					model: `${usedProvider}/${baseModelName}`,
					choices: [
						{
							index: 0,
							message: {
								role: "assistant",
								content: content,
								...(images && images.length > 0 && { images }),
							},
							finish_reason: finishReason ?? "stop",
						},
					],
					usage: buildUsageObject(
						promptTokens,
						completionTokens,
						totalTokens,
						reasoningTokens,
						cachedTokens,
						costs,
						showUpgradeMessage,
					),
					metadata: buildMetadata(
						requestedModel,
						requestedProvider,
						baseModelName,
						usedProvider,
						usedModel,
						requestId,
						routing,
						usedRegion,
					),
				};
			} else {
				// Standard Alibaba chat completions format (OpenAI-compatible)
				if (transformedResponse && typeof transformedResponse === "object") {
					if (transformedResponse.choices?.[0]?.message) {
						const message = transformedResponse.choices[0].message;
						if (content !== null) {
							message.content = content;
						}
						if (reasoningContent !== null) {
							message.reasoning = reasoningContent;
							delete message.reasoning_content;
						}
					}
					if (transformedResponse.choices?.[0] && finishReason !== null) {
						transformedResponse.choices[0].finish_reason = finishReason;
					}
					transformedResponse.model = `${usedProvider}/${baseModelName}`;
					transformedResponse.metadata = buildMetadata(
						requestedModel,
						requestedProvider,
						baseModelName,
						usedProvider,
						usedModel,
						requestId,
						routing,
						usedRegion,
					);
					if (transformedResponse.usage) {
						if (costs !== null) {
							transformedResponse.usage = {
								...transformedResponse.usage,
								cost_usd_total: costs.totalCost,
								cost_usd_input: costs.inputCost,
								cost_usd_output: costs.outputCost,
								cost_usd_cached_input: costs.cachedInputCost,
								cost_usd_request: costs.requestCost,
								cost_usd_image_input: costs.imageInputCost,
								cost_usd_image_output: costs.imageOutputCost,
							};
						}
						if (showUpgradeMessage) {
							transformedResponse.usage = {
								...transformedResponse.usage,
								info: "upgrade to pro to include usd cost breakdown",
							};
						}
					}
				}
			}
			break;
		}
		case "azure":
		case "mistral":
		case "novita":
		case "openai": {
			// Handle OpenAI responses format transformation to chat completions format
			if (json.output && Array.isArray(json.output)) {
				// This is from the responses endpoint - transform to chat completions format
				transformedResponse = {
					id: json.id ?? `chatcmpl-${Date.now()}`,
					object: "chat.completion",
					created: json.created_at ?? Math.floor(Date.now() / 1000),
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
								...(annotations && annotations.length > 0 && { annotations }),
							},
							finish_reason: finishReason ?? "stop",
						},
					],
					usage: buildUsageObject(
						promptTokens,
						completionTokens,
						totalTokens,
						reasoningTokens,
						cachedTokens,
						costs,
						showUpgradeMessage,
					),
					metadata: buildMetadata(
						requestedModel,
						requestedProvider,
						baseModelName,
						usedProvider,
						usedModel,
						requestId,
						routing,
					),
				};
			} else {
				// For standard chat completions format, update model field and add metadata
				if (transformedResponse && typeof transformedResponse === "object") {
					// Update content and finish_reason with parsed values
					if (transformedResponse.choices?.[0]?.message) {
						const message = transformedResponse.choices[0].message;
						// Update content with parsed content (handles JSON unwrapping for Mistral/Novita)
						if (content !== null) {
							message.content = content;
						}
						if (reasoningContent !== null) {
							message.reasoning = reasoningContent;
							// Remove the old reasoning_content field if it exists
							delete message.reasoning_content;
						}
						// Add annotations if present
						if (annotations && annotations.length > 0) {
							message.annotations = annotations;
						}
					}
					// Update finish_reason with the mapped value
					if (transformedResponse.choices?.[0] && finishReason !== null) {
						transformedResponse.choices[0].finish_reason = finishReason;
					}

					transformedResponse.model = `${usedProvider}/${baseModelName}`;
					transformedResponse.metadata = buildMetadata(
						requestedModel,
						requestedProvider,
						baseModelName,
						usedProvider,
						usedModel,
						requestId,
						routing,
						usedRegion,
					);
					if (transformedResponse.usage) {
						if (costs !== null) {
							transformedResponse.usage = {
								...transformedResponse.usage,
								cost_usd_total: costs.totalCost,
								cost_usd_input: costs.inputCost,
								cost_usd_output: costs.outputCost,
								cost_usd_cached_input: costs.cachedInputCost,
								cost_usd_request: costs.requestCost,
								cost_usd_image_input: costs.imageInputCost,
								cost_usd_image_output: costs.imageOutputCost,
							};
						}
						if (showUpgradeMessage) {
							transformedResponse.usage = {
								...transformedResponse.usage,
								info: "upgrade to pro to include usd cost breakdown",
							};
						}
					}
				}
			}
			break;
		}
		case "bytedance": {
			// Check if this is a Seedream image generation response
			// Format: { data: [{ url: "..." }] }
			if (json.data && Array.isArray(json.data)) {
				transformedResponse = {
					id: `chatcmpl-${Date.now()}`,
					object: "chat.completion",
					created: json.created ?? Math.floor(Date.now() / 1000),
					model: `${usedProvider}/${baseModelName}`,
					choices: [
						{
							index: 0,
							message: {
								role: "assistant",
								content: content,
								...(images && images.length > 0 && { images }),
							},
							finish_reason: finishReason ?? "stop",
						},
					],
					usage: buildUsageObject(
						promptTokens,
						completionTokens,
						totalTokens,
						reasoningTokens,
						cachedTokens,
						costs,
						showUpgradeMessage,
					),
					metadata: buildMetadata(
						requestedModel,
						requestedProvider,
						baseModelName,
						usedProvider,
						usedModel,
						requestId,
						routing,
					),
				};
			} else {
				// Standard ByteDance chat completions format (OpenAI-compatible)
				if (transformedResponse && typeof transformedResponse === "object") {
					if (transformedResponse.choices?.[0]?.message) {
						const message = transformedResponse.choices[0].message;
						if (content !== null) {
							message.content = content;
						}
						if (reasoningContent !== null) {
							message.reasoning = reasoningContent;
							delete message.reasoning_content;
						}
					}
					if (transformedResponse.choices?.[0] && finishReason !== null) {
						transformedResponse.choices[0].finish_reason = finishReason;
					}
					transformedResponse.model = `${usedProvider}/${baseModelName}`;
					transformedResponse.metadata = buildMetadata(
						requestedModel,
						requestedProvider,
						baseModelName,
						usedProvider,
						usedModel,
						requestId,
						routing,
						usedRegion,
					);
					if (transformedResponse.usage) {
						if (costs !== null) {
							transformedResponse.usage = {
								...transformedResponse.usage,
								cost_usd_total: costs.totalCost,
								cost_usd_input: costs.inputCost,
								cost_usd_output: costs.outputCost,
								cost_usd_cached_input: costs.cachedInputCost,
								cost_usd_request: costs.requestCost,
								cost_usd_image_input: costs.imageInputCost,
								cost_usd_image_output: costs.imageOutputCost,
							};
						}
						if (showUpgradeMessage) {
							transformedResponse.usage = {
								...transformedResponse.usage,
								info: "upgrade to pro to include usd cost breakdown",
							};
						}
					}
				}
			}
			break;
		}
		case "xai": {
			// Check if this is a Grok Imagine image generation response
			// Format: { data: [{ url: "..." }] }
			if (json.data && Array.isArray(json.data)) {
				transformedResponse = {
					id: `chatcmpl-${Date.now()}`,
					object: "chat.completion",
					created: json.created ?? Math.floor(Date.now() / 1000),
					model: `${usedProvider}/${baseModelName}`,
					choices: [
						{
							index: 0,
							message: {
								role: "assistant",
								content: content,
								...(images && images.length > 0 && { images }),
							},
							finish_reason: finishReason ?? "stop",
						},
					],
					usage: buildUsageObject(
						promptTokens,
						completionTokens,
						totalTokens,
						reasoningTokens,
						cachedTokens,
						costs,
						showUpgradeMessage,
					),
					metadata: buildMetadata(
						requestedModel,
						requestedProvider,
						baseModelName,
						usedProvider,
						usedModel,
						requestId,
						routing,
					),
				};
			} else {
				// Standard xAI chat completions format (OpenAI-compatible)
				if (transformedResponse && typeof transformedResponse === "object") {
					if (transformedResponse.choices?.[0]?.message) {
						const message = transformedResponse.choices[0].message;
						if (content !== null) {
							message.content = content;
						}
						if (reasoningContent !== null) {
							message.reasoning = reasoningContent;
							delete message.reasoning_content;
						}
					}
					if (transformedResponse.choices?.[0] && finishReason !== null) {
						transformedResponse.choices[0].finish_reason = finishReason;
					}
					transformedResponse.model = `${usedProvider}/${baseModelName}`;
					transformedResponse.metadata = buildMetadata(
						requestedModel,
						requestedProvider,
						baseModelName,
						usedProvider,
						usedModel,
						requestId,
						routing,
						usedRegion,
					);
					if (transformedResponse.usage) {
						if (costs !== null) {
							transformedResponse.usage = {
								...transformedResponse.usage,
								cost_usd_total: costs.totalCost,
								cost_usd_input: costs.inputCost,
								cost_usd_output: costs.outputCost,
								cost_usd_cached_input: costs.cachedInputCost,
								cost_usd_request: costs.requestCost,
								cost_usd_image_input: costs.imageInputCost,
								cost_usd_image_output: costs.imageOutputCost,
							};
						}
						if (showUpgradeMessage) {
							transformedResponse.usage = {
								...transformedResponse.usage,
								info: "upgrade to pro to include usd cost breakdown",
							};
						}
					}
				}
			}
			break;
		}
		case "embercloud":
		case "zai": {
			// Check if this is a CogView image generation response
			// Format: { created: number, data: [{ url: "..." }] }
			if (json.data && Array.isArray(json.data)) {
				transformedResponse = {
					id: `chatcmpl-${Date.now()}`,
					object: "chat.completion",
					created: json.created ?? Math.floor(Date.now() / 1000),
					model: `${usedProvider}/${baseModelName}`,
					choices: [
						{
							index: 0,
							message: {
								role: "assistant",
								content: content,
								...(images && images.length > 0 && { images }),
							},
							finish_reason: finishReason ?? "stop",
						},
					],
					usage: buildUsageObject(
						promptTokens,
						completionTokens,
						totalTokens,
						reasoningTokens,
						cachedTokens,
						costs,
						showUpgradeMessage,
					),
					metadata: buildMetadata(
						requestedModel,
						requestedProvider,
						baseModelName,
						usedProvider,
						usedModel,
						requestId,
						routing,
					),
				};
			} else {
				// Standard ZAI chat completions format (OpenAI-compatible)
				if (transformedResponse && typeof transformedResponse === "object") {
					if (transformedResponse.choices?.[0]?.message) {
						const message = transformedResponse.choices[0].message;
						if (content !== null) {
							message.content = content;
						}
						if (reasoningContent !== null) {
							message.reasoning = reasoningContent;
							delete message.reasoning_content;
						}
					}
					if (transformedResponse.choices?.[0] && finishReason !== null) {
						transformedResponse.choices[0].finish_reason = finishReason;
					}
					transformedResponse.model = `${usedProvider}/${baseModelName}`;
					transformedResponse.metadata = buildMetadata(
						requestedModel,
						requestedProvider,
						baseModelName,
						usedProvider,
						usedModel,
						requestId,
						routing,
						usedRegion,
					);
					if (transformedResponse.usage) {
						if (costs !== null) {
							transformedResponse.usage = {
								...transformedResponse.usage,
								cost_usd_total: costs.totalCost,
								cost_usd_input: costs.inputCost,
								cost_usd_output: costs.outputCost,
								cost_usd_cached_input: costs.cachedInputCost,
								cost_usd_request: costs.requestCost,
								cost_usd_image_input: costs.imageInputCost,
								cost_usd_image_output: costs.imageOutputCost,
							};
						}
						if (showUpgradeMessage) {
							transformedResponse.usage = {
								...transformedResponse.usage,
								info: "upgrade to pro to include usd cost breakdown",
							};
						}
					}
				}
			}
			break;
		}
		default: {
			// For any other provider, add metadata to existing response
			if (transformedResponse && typeof transformedResponse === "object") {
				// Ensure content and reasoning fields are present with parsed/healed values
				if (transformedResponse.choices?.[0]?.message) {
					const message = transformedResponse.choices[0].message;
					// Update content with parsed content (includes healed JSON for response healing)
					if (content !== null) {
						message.content = content;
					}
					if (reasoningContent !== null) {
						message.reasoning = reasoningContent;
						// Remove the old reasoning_content field if it exists
						delete message.reasoning_content;
					}
					// Add annotations if present
					if (annotations && annotations.length > 0) {
						message.annotations = annotations;
					}
				}
				transformedResponse.model = `${usedProvider}/${baseModelName}`;
				transformedResponse.metadata = buildMetadata(
					requestedModel,
					requestedProvider,
					baseModelName,
					usedProvider,
					usedModel,
					requestId,
					routing,
					usedRegion,
				);
				if (transformedResponse.usage) {
					if (costs !== null) {
						transformedResponse.usage = {
							...transformedResponse.usage,
							cost_usd_total: costs.totalCost,
							cost_usd_input: costs.inputCost,
							cost_usd_output: costs.outputCost,
							cost_usd_cached_input: costs.cachedInputCost,
							cost_usd_request: costs.requestCost,
							cost_usd_image_input: costs.imageInputCost,
							cost_usd_image_output: costs.imageOutputCost,
						};
					}
					if (showUpgradeMessage) {
						transformedResponse.usage = {
							...transformedResponse.usage,
							info: "upgrade to pro to include usd cost breakdown",
						};
					}
				}
			}
			break;
		}
	}

	return transformedResponse;
}
