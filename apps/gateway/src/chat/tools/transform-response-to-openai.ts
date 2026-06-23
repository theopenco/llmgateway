import { dedupeGoogleCandidateParts } from "./google-candidates.js";
import { mapFinishReasonToOpenai } from "./map-finish-reason-to-openai.js";
import { formatUsedModelForDisplay } from "./resolve-provider-context.js";

import type { RoutingAttempt } from "./retry-with-fallback.js";
import type { Annotation, ImageObject } from "./types.js";
import type { Provider } from "@llmgateway/models";

export interface CostData {
	inputCost: number | null;
	outputCost: number | null;
	cachedInputCost: number | null;
	cacheWriteInputCost?: number | null;
	requestCost: number | null;
	webSearchCost: number | null;
	contentFilterCost?: number | null;
	imageInputCost: number | null;
	imageOutputCost: number | null;
	audioInputCost?: number | null;
	totalCost: number | null;
	dataStorageCost?: number | null;
}

export interface ResponseMetadataExtras {
	logId?: string;
	organizationId?: string;
	projectId?: string;
	discount?: number | null;
}

export function toResponseMetadataExtras(
	extras?: ResponseMetadataExtras,
): Record<string, unknown> {
	if (!extras) {
		return {};
	}

	return {
		...(extras.logId ? { log_id: extras.logId } : {}),
		...(extras.organizationId
			? { organization_id: extras.organizationId }
			: {}),
		...(extras.projectId ? { project_id: extras.projectId } : {}),
		discount: extras.discount ?? null,
	};
}

export function applyExtendedUsageFields(
	usage: Record<string, any>,
	options: {
		costs?: CostData | null;
		cachedTokens?: number | null;
		cacheCreationTokens?: number | null;
		cacheCreation5mTokens?: number | null;
		cacheCreation1hTokens?: number | null;
		reasoningTokens?: number | null;
		imageInputTokens?: number | null;
		imageOutputTokens?: number | null;
		audioInputTokens?: number | null;
	},
): Record<string, any> {
	const {
		costs,
		cachedTokens,
		cacheCreationTokens,
		cacheCreation5mTokens,
		cacheCreation1hTokens,
		reasoningTokens,
		imageInputTokens,
		imageOutputTokens,
		audioInputTokens,
	} = options;

	if (costs) {
		if (costs.totalCost !== null && costs.totalCost !== undefined) {
			usage.cost = costs.totalCost;
		}
		const hasInferenceCosts =
			costs.inputCost !== null ||
			costs.cachedInputCost !== null ||
			costs.outputCost !== null;
		const hasContentFilterCost =
			costs.contentFilterCost !== null &&
			costs.contentFilterCost !== undefined &&
			costs.contentFilterCost > 0;
		if (hasInferenceCosts || hasContentFilterCost) {
			const inputCost = costs.inputCost ?? 0;
			const cachedInputCost = costs.cachedInputCost ?? 0;
			const cacheWriteInputCost = costs.cacheWriteInputCost ?? 0;
			const outputCost = costs.outputCost ?? 0;
			const promptCost = inputCost + cachedInputCost + cacheWriteInputCost;
			const completionsCost = outputCost;
			// upstream_inference_cost intentionally excludes requestCost/webSearchCost, so usage.cost may be larger.
			usage.cost_details = {
				upstream_inference_cost: promptCost + completionsCost,
				upstream_inference_prompt_cost: promptCost,
				upstream_inference_completions_cost: completionsCost,
				total_cost: costs.totalCost,
				input_cost: costs.inputCost,
				output_cost: costs.outputCost,
				cached_input_cost: costs.cachedInputCost,
				cache_write_input_cost: costs.cacheWriteInputCost,
				request_cost: costs.requestCost,
				web_search_cost: costs.webSearchCost,
				image_input_cost: costs.imageInputCost,
				image_output_cost: costs.imageOutputCost,
				audio_input_cost: costs.audioInputCost ?? null,
				...(hasContentFilterCost && {
					content_filter_cost: costs.contentFilterCost,
				}),
				...(costs.dataStorageCost !== null &&
					costs.dataStorageCost !== undefined && {
						data_storage_cost: costs.dataStorageCost,
					}),
			};
		}
	}

	const existingPromptDetails =
		(usage.prompt_tokens_details as Record<string, any> | undefined) ?? {};
	const resolvedCacheRead =
		existingPromptDetails.cached_tokens ?? cachedTokens ?? 0;
	const resolvedCacheWrite =
		existingPromptDetails.cache_write_tokens ??
		existingPromptDetails.cache_creation_tokens ??
		cacheCreationTokens ??
		0;
	const resolvedPromptImageTokens =
		imageInputTokens ?? existingPromptDetails.image_tokens ?? 0;
	const resolvedPromptAudioTokens =
		audioInputTokens ?? existingPromptDetails.audio_tokens ?? 0;
	// `cache_write_tokens` is the canonical field; `cache_creation_tokens` is emitted
	// alongside it for backward compatibility with consumers that read the older name.
	// Readers should prefer `cache_write_tokens ?? cache_creation_tokens`.
	const existingBreakdown =
		(existingPromptDetails.cache_creation as
			| {
					ephemeral_5m_input_tokens?: number;
					ephemeral_1h_input_tokens?: number;
			  }
			| undefined) ?? undefined;
	const resolved1h =
		cacheCreation1hTokens ??
		existingBreakdown?.ephemeral_1h_input_tokens ??
		null;
	const resolved5m =
		cacheCreation5mTokens ??
		existingBreakdown?.ephemeral_5m_input_tokens ??
		(resolvedCacheWrite > 0 && resolved1h !== null
			? Math.max(0, resolvedCacheWrite - resolved1h)
			: null);
	const includeBreakdown =
		resolvedCacheWrite > 0 && (resolved5m !== null || resolved1h !== null);
	usage.prompt_tokens_details = {
		...existingPromptDetails,
		cached_tokens: resolvedCacheRead,
		cache_write_tokens: resolvedCacheWrite,
		audio_tokens: resolvedPromptAudioTokens,
		video_tokens: existingPromptDetails.video_tokens ?? 0,
		image_tokens: resolvedPromptImageTokens,
		...(resolvedCacheWrite > 0 && {
			cache_creation_tokens: resolvedCacheWrite,
		}),
		...(includeBreakdown && {
			cache_creation: {
				ephemeral_5m_input_tokens: resolved5m ?? 0,
				ephemeral_1h_input_tokens: resolved1h ?? 0,
			},
		}),
	};

	const existingCompletionDetails =
		(usage.completion_tokens_details as Record<string, any> | undefined) ?? {};
	const resolvedReasoning =
		existingCompletionDetails.reasoning_tokens ??
		(typeof usage.reasoning_tokens === "number"
			? usage.reasoning_tokens
			: undefined) ??
		reasoningTokens ??
		0;
	const resolvedCompletionImageTokens =
		imageOutputTokens ?? existingCompletionDetails.image_tokens ?? 0;
	usage.completion_tokens_details = {
		...existingCompletionDetails,
		reasoning_tokens: resolvedReasoning,
		image_tokens: resolvedCompletionImageTokens,
		audio_tokens: existingCompletionDetails.audio_tokens ?? 0,
	};

	return usage;
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
	delete nextMetadata.log_id;
	delete nextMetadata.organization_id;
	delete nextMetadata.project_id;
	delete nextMetadata.discount;

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
>(response: T, requestId: string, extras?: ResponseMetadataExtras): T {
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
			...toResponseMetadataExtras(extras),
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
	cacheCreationTokens: number | null = null,
	imageInputTokens: number | null = null,
	imageOutputTokens: number | null = null,
	cacheCreation5mTokens: number | null = null,
	cacheCreation1hTokens: number | null = null,
	audioInputTokens: number | null = null,
) {
	const usage: Record<string, any> = {
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
		...(showUpgradeMessage && {
			info: "upgrade to pro to include usd cost breakdown",
		}),
	};

	applyExtendedUsageFields(usage, {
		costs,
		cachedTokens,
		cacheCreationTokens,
		cacheCreation5mTokens,
		cacheCreation1hTokens,
		reasoningTokens,
		imageInputTokens,
		imageOutputTokens,
		audioInputTokens,
	});

	return usage;
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
	cacheCreationTokens: number | null = null,
	imageInputTokens: number | null = null,
	imageOutputTokens: number | null = null,
	cacheCreation5mTokens: number | null = null,
	cacheCreation1hTokens: number | null = null,
	audioInputTokens: number | null = null,
	serviceTier?: string,
) {
	let transformedResponse = json;

	switch (usedProvider) {
		case "google-ai-studio":
		case "glacier":
		case "google-vertex":
		case "quartz": {
			// Multi-candidate responses (n > 1 via candidateCount) map each Google
			// candidate to its own OpenAI choice. The pre-parsed content/reasoning
			// arguments aggregate every candidate for the log row, so re-extract
			// per-candidate output from the (de-duplicated) raw parts here. The
			// single-candidate path keeps using the pre-parsed values, which also
			// carry response healing and image-generation labels.
			const googleCandidates = dedupeGoogleCandidateParts(
				Array.isArray(json?.candidates) ? json.candidates : [],
				usedProvider,
			);
			const googleChoices =
				googleCandidates.length > 1
					? googleCandidates.map((candidate: any, position: number) => {
							const candidateParts = candidate?.content?.parts ?? [];
							const candidateContent = candidateParts
								.filter((part: any) => !part.thought)
								.map((part: any) => part.text)
								.join("");
							const candidateReasoning = candidateParts
								.filter((part: any) => part.thought)
								.map((part: any) => part.text)
								.join("");
							const candidateIndex = candidate.index ?? position;
							const candidateToolCalls = candidateParts
								.filter((part: any) => part.functionCall)
								.map((part: any, fcIndex: number) => ({
									// Same id scheme as parse-provider-response so choice 0's
									// ids line up with the cached thought signatures.
									id: `${part.functionCall.name}_${candidateIndex}_${fcIndex}`,
									type: "function",
									function: {
										name: part.functionCall.name,
										arguments: JSON.stringify(part.functionCall.args ?? {}),
									},
								}));
							return {
								index: candidateIndex,
								message: {
									role: "assistant",
									content:
										candidateContent.length > 0 ? candidateContent : null,
									...(candidateReasoning.length > 0 && {
										reasoning: candidateReasoning,
									}),
									...(candidateToolCalls.length > 0 && {
										tool_calls: candidateToolCalls,
									}),
									...(position === 0 &&
										images &&
										images.length > 0 && { images }),
									...(position === 0 &&
										annotations &&
										annotations.length > 0 && { annotations }),
								},
								finish_reason: mapFinishReasonToOpenai(
									candidate.finishReason ?? finishReason,
									usedProvider,
									candidateToolCalls.length > 0,
								),
							};
						})
					: [
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
								finish_reason: mapFinishReasonToOpenai(
									finishReason,
									usedProvider,
									!!toolResults,
								),
							},
						];
			transformedResponse = {
				id: `chatcmpl-${Date.now()}`,
				object: "chat.completion",
				created: Math.floor(Date.now() / 1000),
				model: formatUsedModelForDisplay(
					usedProvider,
					baseModelName,
					undefined,
					usedRegion,
				),
				choices: googleChoices,
				usage: buildUsageObject(
					promptTokens,
					completionTokens,
					totalTokens,
					reasoningTokens,
					cachedTokens,
					costs,
					showUpgradeMessage,
					cacheCreationTokens,
					imageInputTokens,
					imageOutputTokens,
					cacheCreation5mTokens,
					cacheCreation1hTokens,
					audioInputTokens,
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
		case "anthropic":
		case "vertex-anthropic": {
			transformedResponse = {
				id: `chatcmpl-${Date.now()}`,
				object: "chat.completion",
				created: Math.floor(Date.now() / 1000),
				model: formatUsedModelForDisplay(
					usedProvider,
					baseModelName,
					undefined,
					usedRegion,
				),
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
						finish_reason: mapFinishReasonToOpenai(
							finishReason,
							usedProvider,
							!!toolResults,
						),
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
					cacheCreationTokens,
					imageInputTokens,
					imageOutputTokens,
					cacheCreation5mTokens,
					cacheCreation1hTokens,
					audioInputTokens,
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
		case "together-ai":
		case "groq": {
			if (!transformedResponse.id) {
				transformedResponse = {
					id: `chatcmpl-${Date.now()}`,
					object: "chat.completion",
					created: Math.floor(Date.now() / 1000),
					model: formatUsedModelForDisplay(
						usedProvider,
						baseModelName,
						undefined,
						usedRegion,
					),
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
						cacheCreationTokens,
						imageInputTokens,
						imageOutputTokens,
						cacheCreation5mTokens,
						cacheCreation1hTokens,
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
				transformedResponse.model = formatUsedModelForDisplay(
					usedProvider,
					baseModelName,
					undefined,
					usedRegion,
				);
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
					if (showUpgradeMessage) {
						transformedResponse.usage = {
							...transformedResponse.usage,
							info: "upgrade to pro to include usd cost breakdown",
						};
					}
					applyExtendedUsageFields(transformedResponse.usage, {
						costs,
						cachedTokens,
						cacheCreationTokens,
						reasoningTokens,
					});
				}
			}
			break;
		}
		case "aws-bedrock": {
			transformedResponse = {
				id: `chatcmpl-${Date.now()}`,
				object: "chat.completion",
				created: Math.floor(Date.now() / 1000),
				model: formatUsedModelForDisplay(
					usedProvider,
					baseModelName,
					undefined,
					usedRegion,
				),
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
						// parseProviderResponse already maps Bedrock stop reasons to
						// OpenAI-canonical values; mapFinishReasonToOpenai is idempotent
						// for those and additionally surfaces a "refusal" as
						// "content_filter" for OpenAI-compatible clients.
						finish_reason:
							mapFinishReasonToOpenai(
								finishReason,
								usedProvider,
								!!toolResults,
							) ?? "stop",
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
					cacheCreationTokens,
					imageInputTokens,
					imageOutputTokens,
					cacheCreation5mTokens,
					cacheCreation1hTokens,
					audioInputTokens,
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
					model: formatUsedModelForDisplay(
						usedProvider,
						baseModelName,
						undefined,
						usedRegion,
					),
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
						cacheCreationTokens,
						imageInputTokens,
						imageOutputTokens,
						cacheCreation5mTokens,
						cacheCreation1hTokens,
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
					transformedResponse.model = formatUsedModelForDisplay(
						usedProvider,
						baseModelName,
						undefined,
						usedRegion,
					);
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
						if (showUpgradeMessage) {
							transformedResponse.usage = {
								...transformedResponse.usage,
								info: "upgrade to pro to include usd cost breakdown",
							};
						}
						applyExtendedUsageFields(transformedResponse.usage, {
							costs,
							cachedTokens,
							cacheCreationTokens,
							reasoningTokens,
						});
					}
				}
			}
			break;
		}
		case "azure":
		case "mistral":
		case "novita":
		case "sakana":
		case "openai": {
			// Handle OpenAI / Azure image generation responses (e.g. gpt-image-2)
			// Format: { created: number, data: [{ b64_json?: string, url?: string }], usage?: {...} }
			if (
				(usedProvider === "openai" || usedProvider === "azure") &&
				json.data &&
				Array.isArray(json.data) &&
				!json.choices &&
				!json.output
			) {
				transformedResponse = {
					id: `chatcmpl-${Date.now()}`,
					object: "chat.completion",
					created: json.created ?? Math.floor(Date.now() / 1000),
					model: formatUsedModelForDisplay(
						usedProvider,
						baseModelName,
						undefined,
						usedRegion,
					),
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
						cacheCreationTokens,
						imageInputTokens,
						imageOutputTokens,
						cacheCreation5mTokens,
						cacheCreation1hTokens,
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
			// Handle OpenAI responses format transformation to chat completions format
			if (json.output && Array.isArray(json.output)) {
				// This is from the responses endpoint - transform to chat completions format
				transformedResponse = {
					id: json.id ?? `chatcmpl-${Date.now()}`,
					object: "chat.completion",
					created: json.created_at ?? Math.floor(Date.now() / 1000),
					model: formatUsedModelForDisplay(
						usedProvider,
						baseModelName,
						undefined,
						usedRegion,
					),
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
						cacheCreationTokens,
						imageInputTokens,
						imageOutputTokens,
						cacheCreation5mTokens,
						cacheCreation1hTokens,
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
						// The parsed content/reasoning aggregate every choice for the
						// log row when n > 1, so only write them back into choice 0
						// for single-choice responses — otherwise choice 0 would
						// carry the concatenation of all choices. (Single-choice
						// updates handle JSON unwrapping for Mistral/Novita.)
						const isSingleChoice = transformedResponse.choices.length === 1;
						if (content !== null && isSingleChoice) {
							message.content = content;
						}
						if (reasoningContent !== null && isSingleChoice) {
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

					transformedResponse.model = formatUsedModelForDisplay(
						usedProvider,
						baseModelName,
						undefined,
						usedRegion,
					);
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
						if (showUpgradeMessage) {
							transformedResponse.usage = {
								...transformedResponse.usage,
								info: "upgrade to pro to include usd cost breakdown",
							};
						}
						applyExtendedUsageFields(transformedResponse.usage, {
							costs,
							cachedTokens,
							cacheCreationTokens,
							reasoningTokens,
						});
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
					model: formatUsedModelForDisplay(
						usedProvider,
						baseModelName,
						undefined,
						usedRegion,
					),
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
						cacheCreationTokens,
						imageInputTokens,
						imageOutputTokens,
						cacheCreation5mTokens,
						cacheCreation1hTokens,
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
					transformedResponse.model = formatUsedModelForDisplay(
						usedProvider,
						baseModelName,
						undefined,
						usedRegion,
					);
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
						if (showUpgradeMessage) {
							transformedResponse.usage = {
								...transformedResponse.usage,
								info: "upgrade to pro to include usd cost breakdown",
							};
						}
						applyExtendedUsageFields(transformedResponse.usage, {
							costs,
							cachedTokens,
							cacheCreationTokens,
							reasoningTokens,
						});
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
					model: formatUsedModelForDisplay(
						usedProvider,
						baseModelName,
						undefined,
						usedRegion,
					),
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
						cacheCreationTokens,
						imageInputTokens,
						imageOutputTokens,
						cacheCreation5mTokens,
						cacheCreation1hTokens,
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
					transformedResponse.model = formatUsedModelForDisplay(
						usedProvider,
						baseModelName,
						undefined,
						usedRegion,
					);
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
						if (showUpgradeMessage) {
							transformedResponse.usage = {
								...transformedResponse.usage,
								info: "upgrade to pro to include usd cost breakdown",
							};
						}
						applyExtendedUsageFields(transformedResponse.usage, {
							costs,
							cachedTokens,
							cacheCreationTokens,
							reasoningTokens,
						});
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
					model: formatUsedModelForDisplay(
						usedProvider,
						baseModelName,
						undefined,
						usedRegion,
					),
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
						cacheCreationTokens,
						imageInputTokens,
						imageOutputTokens,
						cacheCreation5mTokens,
						cacheCreation1hTokens,
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
					transformedResponse.model = formatUsedModelForDisplay(
						usedProvider,
						baseModelName,
						undefined,
						usedRegion,
					);
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
						if (showUpgradeMessage) {
							transformedResponse.usage = {
								...transformedResponse.usage,
								info: "upgrade to pro to include usd cost breakdown",
							};
						}
						applyExtendedUsageFields(transformedResponse.usage, {
							costs,
							cachedTokens,
							cacheCreationTokens,
							reasoningTokens,
						});
					}
				}
			}
			break;
		}
		default: {
			// For providers that return non-OpenAI format (e.g. Reve image generation),
			// construct a proper OpenAI-compatible response when we have parsed images/content
			if (
				transformedResponse &&
				typeof transformedResponse === "object" &&
				!transformedResponse.choices &&
				(images.length > 0 || content !== null)
			) {
				transformedResponse = {
					id: `chatcmpl-${Date.now()}`,
					object: "chat.completion",
					created: Math.floor(Date.now() / 1000),
					model: formatUsedModelForDisplay(
						usedProvider,
						baseModelName,
						undefined,
						usedRegion,
					),
					choices: [
						{
							index: 0,
							message: {
								role: "assistant",
								content: content,
								...(images && images.length > 0 && { images }),
							},
							finish_reason: "stop",
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
						cacheCreationTokens,
						imageInputTokens,
						imageOutputTokens,
						cacheCreation5mTokens,
						cacheCreation1hTokens,
						audioInputTokens,
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
				transformedResponse.model = formatUsedModelForDisplay(
					usedProvider,
					baseModelName,
					undefined,
					usedRegion,
				);
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
					if (showUpgradeMessage) {
						transformedResponse.usage = {
							...transformedResponse.usage,
							info: "upgrade to pro to include usd cost breakdown",
						};
					}
					applyExtendedUsageFields(transformedResponse.usage, {
						costs,
						cachedTokens,
						cacheCreationTokens,
						reasoningTokens,
					});
				}
			}
			break;
		}
	}

	if (
		serviceTier !== undefined &&
		transformedResponse &&
		typeof transformedResponse === "object"
	) {
		transformedResponse.service_tier = serviceTier;
	}

	return transformedResponse;
}
