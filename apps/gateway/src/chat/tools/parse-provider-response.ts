import { isToolSearchBlock } from "@llmgateway/actions";
import { redisClient } from "@llmgateway/cache";
import { shortid } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";

import { estimateTokens } from "./estimate-tokens.js";
import {
	adjustGoogleCandidateTokens,
	extractBedrockCacheCreationDetails,
	normalizeCompletionTokens,
} from "./extract-token-usage.js";
import { dedupeGoogleCandidateParts } from "./google-candidates.js";
import {
	buildEncryptedReasoningDetail,
	extractReasoningDetailsText,
	splitReasoningFromTaggedContent,
} from "./reasoning-details.js";

import type { Annotation, ImageObject } from "./types.js";
import type {
	AnthropicNativeBlock,
	Provider,
	ReasoningDetail,
} from "@llmgateway/models";

/**
 * Parses response content and metadata from different providers
 */
export function parseProviderResponse(
	usedProvider: Provider,
	usedModel: string,
	json: any,
	messages: any[] = [],
	supportsReasoning = true,
	splitTaggedReasoning = false,
	webSearchRequested = false,
	/**
	 * Whether the caller forced the search. DashScope reports no search metadata
	 * at all, so its count is inferred from the request — but only a forced
	 * request actually searches, so an unforced one must count zero.
	 */
	webSearchForced = false,
) {
	let content = null;
	let reasoningContent = null;
	let reasoningDetails: ReasoningDetail[] | null = null;
	let messagePhase: string | null = null;
	let messageBeforeToolCalls: boolean | null = null;
	let messageItems: Array<{
		text: string;
		phase?: string;
		preceding_tool_calls: number;
	}> | null = null;
	let reasoningContext: string | null = null;
	let finishReason = null;
	let promptTokens = null;
	let completionTokens = null;
	let totalTokens = null;
	let reasoningTokens = null;
	let cachedTokens = null;
	let cacheCreationTokens = null;
	let cacheCreation5mTokens: number | null = null;
	let cacheCreation1hTokens: number | null = null;
	let imageInputTokens: number | null = null;
	let imageOutputTokens: number | null = null;
	let audioInputTokens: number | null = null;
	let cachedAudioInputTokens: number | null = null;
	let toolResults = null;
	let anthropicNativeBlocks: AnthropicNativeBlock[] | null = null;
	let images: ImageObject[] = [];
	const annotations: Annotation[] = [];
	let webSearchCount = 0;

	const hasInputImages = messages.some((m: any) => {
		if (Array.isArray(m.content)) {
			return m.content.some((p: any) => p.type === "image_url");
		}
		return false;
	});
	const imageLabel = hasInputImages ? "Image edited" : "Image generated";

	switch (usedProvider) {
		case "aws-bedrock": {
			if (Array.isArray(json.choices)) {
				const allChoices = json.choices;
				toolResults = allChoices[0]?.message?.tool_calls ?? null;

				let aggregatedContent = "";
				let aggregatedReasoning = "";
				let hasContent = false;
				let hasReasoning = false;
				for (const choice of allChoices) {
					const cContent = choice?.message?.content;
					if (typeof cContent === "string") {
						aggregatedContent += cContent;
						hasContent = true;
					}
					const cReasoning =
						choice?.message?.reasoning ??
						choice?.message?.reasoning_content ??
						extractReasoningDetailsText(choice?.message?.reasoning_details) ??
						null;
					if (typeof cReasoning === "string" && cReasoning.length > 0) {
						aggregatedReasoning += cReasoning;
						hasReasoning = true;
					}
				}

				content = hasContent ? aggregatedContent : null;
				reasoningContent = hasReasoning ? aggregatedReasoning : null;
				finishReason = allChoices[0]?.finish_reason ?? null;
				promptTokens = json.usage?.prompt_tokens ?? null;
				completionTokens = json.usage?.completion_tokens ?? null;
				reasoningTokens =
					json.usage?.reasoning_tokens ??
					json.usage?.completion_tokens_details?.reasoning_tokens ??
					null;
				cachedTokens = json.usage?.prompt_tokens_details?.cached_tokens ?? null;
				totalTokens =
					json.usage?.total_tokens ??
					(promptTokens !== null && completionTokens !== null
						? promptTokens + completionTokens
						: null);
				break;
			}

			// AWS Bedrock Converse API format
			// Response format: { output: { message: { content: [{text: "..."}], role: "assistant" }}, stopReason: "end_turn", usage: {...} }
			const message = json.output?.message;
			const contentBlocks = message?.content ?? [];

			// Extract text content from content blocks
			content =
				contentBlocks
					.filter((block: any) => block.text)
					.map((block: any) => block.text)
					.join("") ?? null;

			// Bedrock reasoning-capable Anthropic models return reasoning in
			// content blocks as reasoningContent.reasoningText.text.
			reasoningContent =
				contentBlocks
					.map((block: any) => {
						const reasoning = block.reasoningContent;
						if (!reasoning) {
							return null;
						}
						if (typeof reasoning === "string") {
							return reasoning;
						}
						if (typeof reasoning.reasoningText?.text === "string") {
							return reasoning.reasoningText.text;
						}
						if (typeof reasoning.text === "string") {
							return reasoning.text;
						}
						return null;
					})
					.filter((value: string | null): value is string => value !== null)
					.join("") ?? null;

			// Map Bedrock stop reasons to OpenAI finish reasons
			const stopReason = json.stopReason;
			if (stopReason === "end_turn") {
				finishReason = "stop";
			} else if (
				stopReason === "max_tokens" ||
				stopReason === "model_context_window_exceeded"
			) {
				finishReason = "length";
			} else if (stopReason === "tool_use") {
				finishReason = "tool_calls";
			} else if (stopReason === "content_filtered") {
				finishReason = "content_filter";
			} else if (stopReason === "refusal") {
				// Anthropic-on-Bedrock safety-classifier refusal. Preserve the raw
				// reason so downstream billing can skip charging an unbilled refusal
				// (getUnifiedFinishReason maps it to content_filter for the log).
				finishReason = "refusal";
			} else {
				finishReason = "stop"; // default fallback
			}

			// Extract usage tokens (including cached tokens for prompt caching)
			if (json.usage) {
				const inputTokens = json.usage.inputTokens ?? 0;
				const cacheReadTokens = json.usage.cacheReadInputTokens ?? 0;
				const cacheWriteTokens = json.usage.cacheWriteInputTokens ?? 0;
				const cacheDetails = extractBedrockCacheCreationDetails(json.usage);

				// Total prompt tokens = regular input + cache read + cache write
				promptTokens = inputTokens + cacheReadTokens + cacheWriteTokens;
				completionTokens = json.usage.outputTokens ?? null;
				// The Bedrock Converse API does not break out reasoning tokens; they
				// are bundled into outputTokens (unlike the direct Anthropic API,
				// which reports output_tokens_details.thinking_tokens). Reasoning
				// *content* is still surfaced via the reasoningContent blocks above.
				totalTokens = json.usage.totalTokens ?? null;
				// Cached tokens are the tokens read from cache (discount applies to these)
				cachedTokens = cacheReadTokens;
				cacheCreationTokens = cacheWriteTokens;
				cacheCreation5mTokens = cacheDetails.cacheCreation5mTokens;
				cacheCreation1hTokens = cacheDetails.cacheCreation1hTokens;
			}

			// Extract tool calls if present
			const toolUseBlocks = contentBlocks.filter((block: any) => block.toolUse);
			if (toolUseBlocks.length > 0) {
				toolResults = toolUseBlocks.map((block: any) => ({
					id: block.toolUse.toolUseId,
					type: "function",
					function: {
						name: block.toolUse.name,
						arguments: JSON.stringify(block.toolUse.input),
					},
				}));
			}

			break;
		}
		case "anthropic":
		case "vertex-anthropic":
		case "azure-anthropic": {
			// Extract content and reasoning content from Anthropic response
			const contentBlocks = json.content ?? [];
			const textBlocks = contentBlocks.filter(
				(block: any) => block.type === "text",
			);
			const thinkingBlocks = contentBlocks.filter(
				(block: any) => block.type === "thinking",
			);

			content = textBlocks.map((block: any) => block.text).join("") ?? null;
			reasoningContent =
				thinkingBlocks.map((block: any) => block.thinking).join("") ?? null;

			finishReason = json.stop_reason ?? null;

			// Extract web search citations from Anthropic response
			// Anthropic returns web_search_tool_result blocks with content that includes source info
			const webSearchBlocks = contentBlocks.filter(
				(block: any) => block.type === "web_search_tool_result",
			);
			if (webSearchBlocks.length > 0) {
				webSearchCount = webSearchBlocks.length;
				// Extract citations from each web search result
				for (const block of webSearchBlocks) {
					if (block.content && Array.isArray(block.content)) {
						for (const item of block.content) {
							if (item.type === "web_search_result") {
								annotations.push({
									type: "url_citation",
									url_citation: {
										url: item.url ?? "",
										title: item.title,
									},
								});
							}
						}
					}
				}
			}

			// Also check for citations in text blocks (inline citations)
			for (const block of textBlocks) {
				if (block.citations && Array.isArray(block.citations)) {
					for (const citation of block.citations) {
						annotations.push({
							type: "url_citation",
							url_citation: {
								url: citation.url ?? "",
								title: citation.title,
								start_index: citation.start_char_index,
								end_index: citation.end_char_index,
							},
						});
					}
				}
			}

			// For Anthropic: input_tokens are the non-cached tokens
			// We need to add cache_creation_input_tokens to get total input tokens
			if (json.usage) {
				const inputTokens = json.usage.input_tokens ?? 0;
				// Anthropic supports two cache TTLs (5m at 1.25x, 1h at 2x).
				// `cache_creation_input_tokens` is the sum; the per-TTL breakdown is in
				// `usage.cache_creation.{ephemeral_5m_input_tokens, ephemeral_1h_input_tokens}`.
				const cacheCreation = json.usage.cache_creation_input_tokens ?? 0;
				const cacheCreation5m =
					json.usage.cache_creation?.ephemeral_5m_input_tokens ?? 0;
				const cacheCreation1h =
					json.usage.cache_creation?.ephemeral_1h_input_tokens ?? 0;
				const cacheReadTokens = json.usage.cache_read_input_tokens ?? 0;

				// Total prompt tokens = non-cached + cache creation + cache read
				promptTokens = inputTokens + cacheCreation + cacheReadTokens;
				completionTokens = json.usage.output_tokens ?? null;
				// Anthropic reports thinking tokens under
				// `output_tokens_details.thinking_tokens` (adaptive thinking returns
				// an encrypted thinking block with no text, so this is the only
				// signal that reasoning happened). Keep the legacy field as a fallback.
				reasoningTokens =
					json.usage.output_tokens_details?.thinking_tokens ??
					json.usage.reasoning_output_tokens ??
					null;
				// Cached tokens are the tokens read from cache (discount applies to these)
				cachedTokens = cacheReadTokens;
				cacheCreationTokens = cacheCreation;
				cacheCreation5mTokens = cacheCreation5m > 0 ? cacheCreation5m : null;
				cacheCreation1hTokens = cacheCreation1h > 0 ? cacheCreation1h : null;
				totalTokens =
					promptTokens && completionTokens
						? promptTokens + completionTokens
						: null;
			}
			// Server-side tool search leaves a server_tool_use +
			// tool_search_tool_result pair in the content. Neither has an
			// OpenAI-format equivalent, so surface them verbatim for the
			// /v1/messages layer to replay — Anthropic expands the tool_reference
			// entries they carry on every later turn.
			const toolSearchBlocks = contentBlocks.filter(isToolSearchBlock);
			if (toolSearchBlocks.length > 0) {
				anthropicNativeBlocks = toolSearchBlocks;
			}

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
					})) ?? null;
			if (toolResults && toolResults.length === 0) {
				toolResults = null;
			}
			break;
		}
		case "google-ai-studio":
		case "glacier":
		case "iceberg":
		case "google-vertex":
		case "quartz": {
			// A response with no candidates used to be assigned "content_filter"
			// here, which won over the `promptFeedback.blockReason` assignment
			// below, so every such response was logged as the generic
			// "content_filter" and the actual Google reason was lost. When Google
			// reports no reason at all the finish reason is left unset (logged as
			// "unknown") rather than guessing at a block — the warning below
			// carries the full response for diagnosis.
			const missingCandidates =
				!json.candidates || json.candidates.length === 0;
			if (missingCandidates && !json.promptFeedback?.blockReason) {
				logger.warn(
					"[parse-provider-response] Google response missing candidates",
					{
						usedProvider,
						usedModel,
						fullResponse: json,
					},
				);
			}

			// AI Studio duplicates the other candidates' parts into candidate 0
			// when candidateCount > 1 — strip that before any extraction. Gated on
			// the provider so clean responses (e.g. Vertex) are never touched.
			const candidates = dedupeGoogleCandidateParts(
				json.candidates ?? [],
				usedProvider,
			);

			// Extract content and reasoning content from Google response parts.
			// The log row only stores a single content/reasoning string, so for
			// n > 1 we aggregate every candidate into the buffer — otherwise
			// indices > 0 disappear from logs. Tool calls / images stay keyed
			// to candidate 0, mirroring the OpenAI multi-choice behavior.
			const parts = candidates[0]?.content?.parts ?? [];
			const allParts = candidates.flatMap(
				(candidate: any) => candidate?.content?.parts ?? [],
			);
			const contentParts = allParts.filter((part: any) => !part.thought);
			const reasoningParts = allParts.filter((part: any) => part.thought);

			const textContent = contentParts.map((part: any) => part.text).join("");
			const thoughtContent = reasoningParts
				.map((part: any) => part.text)
				.join("");

			content = textContent.length > 0 ? textContent : null;
			reasoningContent = thoughtContent.length > 0 ? thoughtContent : null;

			// Extract images from Google response parts
			const imageParts = parts.filter((part: any) => part.inlineData);
			images = imageParts.map((part: any): ImageObject => ({
				type: "image_url",
				image_url: {
					url: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`,
				},
			}));

			// Set content label for image generation when no text content is present
			if (!content && images.length > 0) {
				content = imageLabel;
			}

			// Debug logging to identify parsing issues
			if (!content && !reasoningContent && parts.length > 0 && !images.length) {
				logger.warn(
					"[parse-provider-response] Google response has parts but no text extracted",
					{
						json,
					},
				);
			}

			// Extract tool calls from Google format - reuse the same parts array
			// Include thoughtSignature if present (required for Gemini 3 multi-turn conversations)
			toolResults =
				parts
					.filter((part: any) => part.functionCall)
					.map((part: any) => {
						const toolCall: any = {
							// Google doesn't provide an id, so generate one. It MUST be
							// globally unique: the id is the `thought_signature:<id>` Redis
							// key, and Gemini rejects a replayed call whose signature came
							// from a different call ("Corrupted thought signature"). A
							// name+index id collapsed to e.g. `read_file_0_0` for every
							// caller, so concurrent conversations — across organizations —
							// overwrote each other's signature in one shared slot.
							id: `${part.functionCall.name}_${shortid(24)}`,
							type: "function",
							function: {
								name: part.functionCall.name,
								arguments: JSON.stringify(part.functionCall.args ?? {}),
							},
						};
						// Cache thoughtSignature for multi-turn conversations
						// This allows us to retrieve it when the client sends back the conversation history
						if (part.thoughtSignature) {
							toolCall.extra_content = {
								google: {
									thought_signature: part.thoughtSignature,
								},
							};
							// Store in Redis for server-side retrieval since OpenAI SDKs don't preserve extra_content
							redisClient
								.setex(
									`thought_signature:${toolCall.id}`,
									86400, // 1 day expiration
									part.thoughtSignature,
								)
								.catch((err) => {
									logger.error("Failed to cache thought_signature", { err });
								});
						}
						return toolCall;
					}) ?? null;
			if (toolResults && toolResults.length === 0) {
				toolResults = null;
			}

			// Also check if text parts have thought signatures and add them to content
			// This allows clients to pass them back in multi-turn conversations
			const textPartsWithSignatures = contentParts.filter(
				(part: any) => part.thoughtSignature,
			);
			if (textPartsWithSignatures.length > 0 && content) {
				// Store the thought signature in a way the client can return it
				// We'll need to enhance the response format to include this
			}

			// Check for prompt feedback block reason (when content is blocked before generation)
			const promptBlockReason = json.promptFeedback?.blockReason;
			const googleFinishReason = json.candidates?.[0]?.finishReason;

			// Preserve the original Google finish reason for logging
			// Use promptBlockReason if present, otherwise use googleFinishReason
			if (!finishReason) {
				if (promptBlockReason) {
					finishReason = promptBlockReason;
				} else if (googleFinishReason) {
					finishReason = googleFinishReason;
				}
			}

			// Extract web search citations from Google grounding metadata
			const groundingMetadata = json.candidates?.[0]?.groundingMetadata;
			if (groundingMetadata) {
				webSearchCount = 1; // Google doesn't report individual search counts
				// Extract from groundingChunks (sources)
				if (
					groundingMetadata.groundingChunks &&
					Array.isArray(groundingMetadata.groundingChunks)
				) {
					for (const chunk of groundingMetadata.groundingChunks) {
						if (chunk.web) {
							annotations.push({
								type: "url_citation",
								url_citation: {
									url: chunk.web.uri ?? "",
									title: chunk.web.title,
								},
							});
						}
					}
				}
				// Also extract from webSearchQueries if available for reference
				if (
					groundingMetadata.webSearchQueries &&
					groundingMetadata.webSearchQueries.length > 0
				) {
					webSearchCount = groundingMetadata.webSearchQueries.length;
				}
			}

			promptTokens = json.usageMetadata?.promptTokenCount ?? null;
			let rawCandidates = json.usageMetadata?.candidatesTokenCount ?? null;
			reasoningTokens = json.usageMetadata?.thoughtsTokenCount ?? null;
			// Extract cached tokens from Google's implicit caching
			cachedTokens = json.usageMetadata?.cachedContentTokenCount ?? null;
			if (Array.isArray(json.usageMetadata?.promptTokensDetails)) {
				for (const detail of json.usageMetadata.promptTokensDetails) {
					if (detail?.modality === "AUDIO" && detail.tokenCount) {
						audioInputTokens = (audioInputTokens ?? 0) + detail.tokenCount;
					}
				}
			}
			if (Array.isArray(json.usageMetadata?.cacheTokensDetails)) {
				for (const detail of json.usageMetadata.cacheTokensDetails) {
					if (detail?.modality === "AUDIO" && detail.tokenCount) {
						cachedAudioInputTokens =
							(cachedAudioInputTokens ?? 0) + detail.tokenCount;
					}
				}
			}

			// Adjust for inconsistent Google API behavior where
			// candidatesTokenCount may already include thoughtsTokenCount
			if (rawCandidates !== null) {
				rawCandidates = adjustGoogleCandidateTokens(
					rawCandidates,
					reasoningTokens,
					promptTokens,
					json.usageMetadata?.totalTokenCount,
				);
			}

			// If candidatesTokenCount is missing, estimate it from the content or set to 0
			if (rawCandidates === null) {
				if (content && images.length === 0) {
					const estimation = estimateTokens(
						usedProvider,
						[],
						content,
						null,
						null,
					);
					rawCandidates = estimation.calculatedCompletionTokens ?? 0;
				} else {
					// No real text content (image-only or empty) means 0 completion tokens
					rawCandidates = 0;
				}
			}

			// completionTokens includes reasoning for correct totals
			completionTokens = rawCandidates + (reasoningTokens ?? 0);

			// Calculate totalTokens
			if (promptTokens !== null) {
				totalTokens = promptTokens + (completionTokens ?? 0);
			}
			break;
		}
		case "mistral":
		case "novita": {
			content = json.choices?.[0]?.message?.content ?? null;
			// Extract reasoning content - check both reasoning and reasoning_content fields
			reasoningContent =
				json.choices?.[0]?.message?.reasoning ??
				json.choices?.[0]?.message?.reasoning_content ??
				extractReasoningDetailsText(
					json.choices?.[0]?.message?.reasoning_details,
				) ??
				null;
			finishReason = json.choices?.[0]?.finish_reason ?? null;
			promptTokens = json.usage?.prompt_tokens ?? null;
			completionTokens = json.usage?.completion_tokens ?? null;
			reasoningTokens =
				json.usage?.reasoning_tokens ??
				json.usage?.completion_tokens_details?.reasoning_tokens ??
				null;
			cachedTokens = json.usage?.prompt_tokens_details?.cached_tokens ?? null;
			totalTokens = json.usage?.total_tokens ?? null;

			// Handle Mistral/Novita JSON output mode which wraps JSON in markdown code blocks
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
					} catch {}
				}
			}

			// Map non-standard finish reasons to OpenAI-compatible values
			if (finishReason === "end_turn") {
				finishReason = "stop";
			} else if (finishReason === "abort") {
				logger.warn("Upstream sent abort finish_reason", {
					provider: usedProvider,
					model: usedModel,
					responseModel: json.model,
					responseId: json.id,
					finishReason: json.choices?.[0]?.finish_reason,
					nativeFinishReason: json.choices?.[0]?.native_finish_reason,
					usage: json.usage,
				});
				// "abort" is an upstream-initiated interruption, not a client
				// cancellation, so it counts as an upstream error.
				finishReason = "upstream_error";
			} else if (finishReason === "tool_use") {
				finishReason = "tool_calls";
			}

			// Extract tool calls from Mistral/Novita format (same as OpenAI)
			toolResults = json.choices?.[0]?.message?.tool_calls ?? null;
			break;
		}
		case "alibaba": {
			// Check if this is a DashScope multimodal generation response (image generation)
			// Format: { output: { choices: [{ message: { content: [{ image: "url" }] } }] }, usage: {...} }
			const alibabaChoices = json.output?.choices;
			if (alibabaChoices && Array.isArray(alibabaChoices)) {
				const messageContent = alibabaChoices[0]?.message?.content;
				if (Array.isArray(messageContent)) {
					// Extract images from content array
					const imageItems = messageContent.filter((item: any) => item.image);
					if (imageItems.length > 0) {
						images = imageItems.map((item: any): ImageObject => ({
							type: "image_url",
							image_url: {
								url: item.image,
							},
						}));
						content = imageLabel;
						finishReason = alibabaChoices[0]?.finish_reason ?? "stop";
						// DashScope image generation uses different usage format
						promptTokens = 0;
						completionTokens = 0;
						totalTokens = 0;
					} else {
						// Text content in DashScope format
						content =
							messageContent
								.filter((item: any) => item.text)
								.map((item: any) => item.text)
								.join("") || null;
						finishReason = alibabaChoices[0]?.finish_reason ?? null;
					}
				}
			} else if (json.choices) {
				// Alibaba chat completions use OpenAI format
				toolResults = json.choices?.[0]?.message?.tool_calls ?? null;
				content = json.choices?.[0]?.message?.content ?? null;
				reasoningContent =
					json.choices?.[0]?.message?.reasoning ??
					json.choices?.[0]?.message?.reasoning_content ??
					extractReasoningDetailsText(
						json.choices?.[0]?.message?.reasoning_details,
					) ??
					null;
				finishReason = json.choices?.[0]?.finish_reason ?? null;
				promptTokens = json.usage?.prompt_tokens ?? null;
				completionTokens = json.usage?.completion_tokens ?? null;
				reasoningTokens =
					json.usage?.reasoning_tokens ??
					json.usage?.completion_tokens_details?.reasoning_tokens ??
					null;
				cachedTokens = json.usage?.prompt_tokens_details?.cached_tokens ?? null;
				totalTokens =
					json.usage?.total_tokens ??
					(promptTokens !== null && completionTokens !== null
						? promptTokens + completionTokens
						: null);
				// Alibaba uses Anthropic-style `cache_control: {type: "ephemeral"}` on
				// the request, but reports usage in OpenAI shape with
				// `cache_creation_input_tokens` nested under `prompt_tokens_details`.
				// `prompt_tokens` already includes cache write/read tokens. Only a 5m
				// TTL exists; write tokens bill at 1.25x.
				const alibabaCacheCreation =
					json.usage?.prompt_tokens_details?.cache_creation_input_tokens ?? 0;
				if (alibabaCacheCreation > 0) {
					cacheCreationTokens = alibabaCacheCreation;
					cacheCreation5mTokens = alibabaCacheCreation;
				}
				if (json.choices?.[0]?.message?.images) {
					images = json.choices[0].message.images;
				}
			}
			// DashScope's OpenAI-compatible protocol never returns `search_info`,
			// so there is no per-response signal that a search ran. Forcing is the
			// only mode that searches, and it always searches, so a forced request
			// is exactly one search and an unforced one is none.
			if (webSearchRequested && webSearchForced) {
				webSearchCount = 1;
			}
			break;
		}
		default: // OpenAI format
			// Check if this is an OpenAI / Azure image generation response (e.g. gpt-image-2)
			// Format: { created: number, data: [{ b64_json?: string, url?: string, revised_prompt?: string }], usage?: {...} }
			if (
				(usedProvider === "openai" || usedProvider === "azure") &&
				json.data &&
				Array.isArray(json.data) &&
				json.data.length > 0 &&
				(json.data[0]?.b64_json || json.data[0]?.url)
			) {
				const imageData = json.data;
				images = imageData.map((item: any): ImageObject => {
					let url: string;
					if (item.b64_json) {
						url = `data:image/png;base64,${item.b64_json}`;
					} else {
						url = item.url;
					}
					return {
						type: "image_url",
						image_url: { url },
					};
				});
				content = imageLabel;
				finishReason = "stop";
				// OpenAI gpt-image models return usage with input/output tokens
				promptTokens = json.usage?.input_tokens ?? 0;
				completionTokens = json.usage?.output_tokens ?? 0;
				cachedTokens = json.usage?.input_tokens_details?.cached_tokens ?? null;
				imageInputTokens =
					json.usage?.input_tokens_details?.image_tokens ?? null;
				imageOutputTokens =
					json.usage?.output_tokens_details?.image_tokens ?? null;
				totalTokens =
					json.usage?.total_tokens ??
					(promptTokens ?? 0) + (completionTokens ?? 0);
				break;
			}
			// Check if this is an xAI Grok Imagine image generation response
			// Format: { data: [{ url: "..." }] }
			if (usedProvider === "xai" && json.data && Array.isArray(json.data)) {
				const imageData = json.data;
				if (imageData.length > 0) {
					images = imageData.map((item: any): ImageObject => ({
						type: "image_url",
						image_url: {
							url: item.url,
						},
					}));
					content = imageLabel;
					finishReason = "stop";
					// Grok Imagine image generation doesn't return token usage
					promptTokens = 0;
					completionTokens = 0;
					totalTokens = 0;
				}
				break;
			}
			// Check if this is a Z.AI CogView image generation response
			// Format: { created: number, data: [{ url: "..." }] }
			if (usedProvider === "zai" && json.data && Array.isArray(json.data)) {
				const imageData = json.data;
				if (imageData.length > 0) {
					images = imageData.map((item: any): ImageObject => ({
						type: "image_url",
						image_url: {
							url: item.url,
						},
					}));
					content = imageLabel;
					finishReason = "stop";
					// CogView image generation doesn't return token usage
					promptTokens = 0;
					completionTokens = 0;
					totalTokens = 0;
				}
				break;
			}
			// Check if this is a ByteDance Seedream image generation response
			// Format: { data: [{ url: "..." }] }
			if (
				usedProvider === "bytedance" &&
				json.data &&
				Array.isArray(json.data)
			) {
				const imageData = json.data;
				if (imageData.length > 0) {
					images = imageData.map((item: any): ImageObject => ({
						type: "image_url",
						image_url: {
							url: item.url,
						},
					}));
					content = imageLabel;
					finishReason = "stop";
					// Seedream image generation doesn't return token usage
					promptTokens = 0;
					completionTokens = 0;
					totalTokens = 0;
				}
				break;
			}
			// Check if this is a Reve image generation response
			// Format: { image: "base64...", version: "...", content_violation: false, ... }
			if (usedProvider === "reve" && typeof json.image === "string") {
				images = [
					{
						type: "image_url",
						image_url: {
							url: `data:image/png;base64,${json.image}`,
						},
					},
				];
				content = imageLabel;
				finishReason = "stop";
				promptTokens = 0;
				completionTokens = 0;
				totalTokens = 0;
				break;
			}
			// Check if this is an OpenAI responses format (has output array instead of choices)
			if (json.output && Array.isArray(json.output)) {
				// OpenAI responses endpoint format
				const messageOutput = json.output.find(
					(item: any) => item.type === "message",
				);
				const imageOutputs = json.output.filter(
					(
						item: Record<string, unknown>,
					): item is Record<string, unknown> & { result: string } =>
						item.type === "image_generation_call" &&
						typeof item.result === "string" &&
						item.result.length > 0,
				);
				if (imageOutputs.length > 0) {
					images = imageOutputs.map(
						(
							item: Record<string, unknown> & { result: string },
						): ImageObject => ({
							type: "image_url",
							image_url: {
								url: `data:image/webp;base64,${item.result}`,
							},
						}),
					);
					content = imageLabel;
				}
				// A response can carry several reasoning items (e.g. one before
				// each tool call), so collect them all once — both the summary text
				// and the encrypted payloads below are derived from every item.
				// Each entry keeps its position in json.output as its index.
				const reasoningOutputs = json.output.flatMap(
					(item: any, index: number) =>
						item.type === "reasoning" ? [{ item, index }] : [],
				);
				const firstFunctionCallIdx = json.output.findIndex(
					(item: any) => item.type === "function_call",
				);

				// Collect ALL message items (models may emit separate phased
				// assistant messages, e.g. commentary and final_answer) with
				// their phase and exact position among the function_call items
				// (how many calls precede each message), so the original
				// interleaving can be reconstructed item-for-item.
				let functionCallsSeen = 0;
				const allMessageOutputs: Array<{
					text: string;
					phase?: string;
					preceding_tool_calls: number;
				}> = [];
				for (const item of json.output) {
					if (item.type === "function_call") {
						functionCallsSeen++;
					} else if (item.type === "message") {
						allMessageOutputs.push({
							text: Array.isArray(item.content)
								? item.content
										.map((part: any) =>
											typeof part?.text === "string" ? part.text : "",
										)
										.join("")
								: "",
							...(typeof item.phase === "string" && {
								phase: item.phase,
							}),
							preceding_tool_calls: functionCallsSeen,
						});
					}
				}

				// Extract message content. With multiple phased messages, join
				// them so nothing is dropped from the chat-completions surface.
				if (allMessageOutputs.length > 1) {
					content =
						allMessageOutputs
							.map((m: { text: string }) => m.text)
							.filter(Boolean)
							.join("\n\n") || content;
				} else if (messageOutput?.content?.[0]?.text) {
					content = messageOutput.content[0].text;
				}

				// Preserve the per-item structure whenever position matters —
				// multiple messages, or any message alongside function calls
				// (a single message may sit BETWEEN two calls, which the flat
				// chat shape cannot express otherwise). Empty-text messages are
				// dropped, matching the converter's empty-message guard.
				const positionedMessages = allMessageOutputs.filter(
					(m) => m.text.trim() !== "",
				);
				if (
					positionedMessages.length > 0 &&
					(allMessageOutputs.length > 1 || functionCallsSeen > 0)
				) {
					messageItems = positionedMessages;
				}

				// Preserve the assistant-message phase (e.g. "final_answer") so
				// clients can replay it in stateless Responses history. With
				// multiple messages the per-item phases live in messageItems.
				if (
					allMessageOutputs.length <= 1 &&
					typeof messageOutput?.phase === "string"
				) {
					messagePhase = messageOutput.phase;
				}

				// Capture the effective reasoning context the provider applied
				// (current_turn/all_turns) so the Responses layer can report it.
				if (
					json.reasoning?.context === "current_turn" ||
					json.reasoning?.context === "all_turns"
				) {
					reasoningContext = json.reasoning.context;
				}

				// Record whether the message item preceded the first function_call
				// (pre-tool commentary) so the Responses converter can rebuild the
				// output array in the provider's original item order. With
				// multiple messages the per-item flags live in messageItems.
				if (allMessageOutputs.length <= 1) {
					const messageIdx = json.output.findIndex(
						(item: any) => item.type === "message",
					);
					if (messageIdx !== -1 && firstFunctionCallIdx !== -1) {
						messageBeforeToolCalls = messageIdx < firstFunctionCallIdx;
					}
				}

				// Extract reasoning content from every item's summary (each may hold
				// multiple parts). Taking only the first item would silently drop the
				// reasoning that preceded later tool calls, and would disagree with
				// the streaming path, which aggregates every summary delta.
				const summaryText = reasoningOutputs
					.flatMap(({ item }: any) =>
						Array.isArray(item.summary)
							? item.summary.map((part: any) => part?.text ?? "")
							: [],
					)
					.filter(Boolean)
					.join("\n\n");
				if (summaryText) {
					reasoningContent = summaryText;
				}

				// Collect encrypted reasoning payloads (returned when the upstream
				// request sets store:false + include:["reasoning.encrypted_content"])
				// so clients can replay them on later turns to preserve reasoning
				// without stored responses.
				const encryptedReasoningDetails = reasoningOutputs.flatMap(
					({ item, index }: any) =>
						typeof item.encrypted_content === "string" &&
						item.encrypted_content.length > 0
							? [buildEncryptedReasoningDetail(item, index)]
							: [],
				);
				if (encryptedReasoningDetails.length > 0) {
					reasoningDetails = encryptedReasoningDetails;
				}

				// Extract tool calls (if any) from the output array and transform to OpenAI format
				const functionCalls = json.output.filter(
					(item: any) => item.type === "function_call",
				);
				if (functionCalls.length > 0) {
					toolResults = functionCalls.map((functionCall: any) => ({
						id: functionCall.call_id ?? functionCall.id,
						type: "function",
						function: {
							name: functionCall.name,
							arguments: functionCall.arguments,
						},
					}));
				} else {
					toolResults = null;
				}

				// Status mapping with tool call detection for responses API
				if (json.status === "completed") {
					// Check if there are tool calls in the response
					if (toolResults && toolResults.length > 0) {
						finishReason = "tool_calls";
					} else {
						finishReason = "stop";
					}
				} else if (json.status === "incomplete") {
					// Mirror the streaming path: surface content-filter truncation
					// distinctly; everything else (max_output_tokens) is "incomplete".
					finishReason =
						json.incomplete_details?.reason === "content_filter"
							? "content_filter"
							: "incomplete";
				} else {
					finishReason = json.status;
				}

				// Usage token extraction
				promptTokens = json.usage?.input_tokens ?? null;
				completionTokens = json.usage?.output_tokens ?? null;
				reasoningTokens =
					json.usage?.output_tokens_details?.reasoning_tokens ?? null;
				cachedTokens = json.usage?.input_tokens_details?.cached_tokens ?? null;
				totalTokens = json.usage?.total_tokens ?? null;
				// GPT-5.6+ bills prompt-cache writes at 1.25x and reports them in
				// `cache_write_tokens` (a subset of input_tokens, like cached_tokens).
				const responsesCacheWrite =
					json.usage?.input_tokens_details?.cache_write_tokens ?? 0;
				if (responsesCacheWrite > 0) {
					cacheCreationTokens = responsesCacheWrite;
				}

				// Sakana Fugu bills the orchestration tokens consumed by its underlying
				// agent pool on top of the user-visible input/output tokens. They are
				// reported in the *_tokens_details and are real billable usage, so fold
				// them into the prompt/completion (and cached) counts used for costing.
				if (usedProvider === "sakana" && json.usage) {
					const inDetails = json.usage.input_tokens_details ?? {};
					const outDetails = json.usage.output_tokens_details ?? {};
					promptTokens =
						(promptTokens ?? 0) + (inDetails.orchestration_input_tokens ?? 0);
					completionTokens =
						(completionTokens ?? 0) +
						(outDetails.orchestration_output_tokens ?? 0);
					cachedTokens =
						(cachedTokens ?? 0) +
						(inDetails.orchestration_input_cached_tokens ?? 0);
				}

				// Count web_search_call items for pricing (each call is billed, not each citation)
				const webSearchCalls = json.output.filter(
					(item: any) => item.type === "web_search_call",
				);
				if (webSearchCalls.length > 0) {
					webSearchCount = webSearchCalls.length;
				}

				// Extract web search citations from OpenAI Responses API format
				// Citations come as annotations in the message content (for display, not pricing)
				if (messageOutput?.content) {
					for (const contentItem of messageOutput.content) {
						if (
							contentItem.annotations &&
							Array.isArray(contentItem.annotations)
						) {
							for (const annotation of contentItem.annotations) {
								if (annotation.type === "url_citation") {
									annotations.push({
										type: "url_citation",
										url_citation: {
											url: annotation.url ?? "",
											title: annotation.title,
											start_index: annotation.start_index,
											end_index: annotation.end_index,
										},
									});
								}
							}
						}
					}
				}
			} else {
				// Standard OpenAI chat completions format. The log row only
				// stores a single content/reasoning string, so for n > 1 we
				// aggregate every choice into the buffer — otherwise indices
				// > 0 disappear from logs. Tool calls / images stay keyed to
				// choice 0; tools combined with n > 1 streaming is rejected
				// upstream and n > 1 with non-streaming tools is a niche.
				const allChoices = Array.isArray(json.choices) ? json.choices : [];
				toolResults = allChoices[0]?.message?.tool_calls ?? null;

				let aggregatedContent = "";
				let aggregatedReasoning = "";
				let hasContent = false;
				let hasReasoning = false;
				for (const choice of allChoices) {
					const cContent = choice?.message?.content;
					if (typeof cContent === "string") {
						aggregatedContent += cContent;
						hasContent = true;
					}
					const cReasoning =
						choice?.message?.reasoning ??
						choice?.message?.reasoning_content ??
						extractReasoningDetailsText(choice?.message?.reasoning_details) ??
						null;
					if (typeof cReasoning === "string" && cReasoning.length > 0) {
						aggregatedReasoning += cReasoning;
						hasReasoning = true;
					}
				}
				content = hasContent ? aggregatedContent : null;
				reasoningContent = hasReasoning ? aggregatedReasoning : null;
				finishReason = allChoices[0]?.finish_reason ?? null;

				// Map non-standard finish reasons to OpenAI-compatible values
				if (finishReason === "end_turn") {
					finishReason = "stop";
				} else if (finishReason === "abort") {
					logger.warn("Upstream sent abort finish_reason", {
						provider: usedProvider,
						model: usedModel,
						responseModel: json.model,
						responseId: json.id,
						finishReason: json.choices?.[0]?.finish_reason,
						nativeFinishReason: json.choices?.[0]?.native_finish_reason,
						usage: json.usage,
					});
					// "abort" is an upstream-initiated interruption, not a client
					// cancellation, so it counts as an upstream error.
					finishReason = "upstream_error";
				} else if (finishReason === "tool_use") {
					finishReason = "tool_calls";
				}

				// ZAI-specific fix for incorrect finish_reason in tool response scenarios
				// Only for models that were failing tests: glm-4.5-airx and glm-4.5-flash
				if (
					usedProvider === "zai" &&
					finishReason === "tool_calls" &&
					messages.length > 0
				) {
					const lastMessage = messages[messages.length - 1];
					const externalId = json.model;

					// Only apply to specific failing models and only when last message was a tool result
					if (
						(externalId === "glm-4.5-airx" || externalId === "glm-4.5-flash") &&
						lastMessage?.role === "tool"
					) {
						// Check if the response actually contains new tool calls that should be prevented
						const hasNewToolCalls =
							json.choices?.[0]?.message?.tool_calls?.length > 0;
						if (hasNewToolCalls) {
							finishReason = "stop";
							// Also update JSON to match
							if (json.choices?.[0]) {
								json.choices[0].finish_reason = "stop";
								delete json.choices[0].message.tool_calls;
							}
						}
					}
				}

				// SCX returns finish_reason "stop" even when the message contains
				// tool calls; normalize to "tool_calls" so downstream consumers see
				// the OpenAI-standard value.
				if (
					usedProvider === "scx-ai" &&
					finishReason === "stop" &&
					Array.isArray(toolResults) &&
					toolResults.length > 0
				) {
					finishReason = "tool_calls";
				}

				// Standard OpenAI-style token parsing
				promptTokens = json.usage?.prompt_tokens ?? null;
				completionTokens = json.usage?.completion_tokens ?? null;
				reasoningTokens =
					json.usage?.reasoning_tokens ??
					json.usage?.completion_tokens_details?.reasoning_tokens ??
					null;
				cachedTokens = json.usage?.prompt_tokens_details?.cached_tokens ?? null;
				totalTokens =
					json.usage?.total_tokens ??
					(promptTokens !== null && completionTokens !== null
						? promptTokens + completionTokens
						: null);
				// GPT-5.6+ bills prompt-cache writes at 1.25x and reports them in
				// `cache_write_tokens` (a subset of prompt_tokens, like cached_tokens).
				const chatCacheWrite =
					json.usage?.prompt_tokens_details?.cache_write_tokens ?? 0;
				if (chatCacheWrite > 0) {
					cacheCreationTokens = chatCacheWrite;
				}

				// Extract images from OpenAI-format response (including Gemini via gateway)
				if (json.choices?.[0]?.message?.images) {
					images = json.choices[0].message.images;
				}

				// Extract web search citations from OpenAI Chat Completions format
				// For search models, citations come in message.annotations
				// Count as 1 search per request if any citations are present (billed per request, not per citation)
				const messageAnnotations =
					json.choices?.[0]?.message?.annotations ?? [];
				let hasSearchCitations = false;
				for (const annotation of messageAnnotations) {
					if (annotation.type === "url_citation") {
						hasSearchCitations = true;
						annotations.push({
							type: "url_citation",
							url_citation: {
								url: annotation.url_citation?.url ?? annotation.url ?? "",
								title: annotation.url_citation?.title ?? annotation.title,
								start_index:
									annotation.url_citation?.start_index ??
									annotation.start_index,
								end_index:
									annotation.url_citation?.end_index ?? annotation.end_index,
							},
						});
					}
				}
				if (hasSearchCitations) {
					webSearchCount = 1; // Search models bill per request, not per citation
				}

				// For ZAI, extract web search info if present
				// ZAI includes web_search content in the response
				if (usedProvider === "zai") {
					const webSearchResults =
						json.choices?.[0]?.message?.web_search ?? null;
					if (webSearchResults && Array.isArray(webSearchResults)) {
						webSearchCount = webSearchResults.length;
						for (const result of webSearchResults) {
							annotations.push({
								type: "url_citation",
								url_citation: {
									url: result.link ?? result.url ?? "",
									title: result.title,
								},
							});
						}
					} else if (webSearchRequested) {
						webSearchCount = 1;
					}
				}

				// SCX resells Qwen through DashScope, which returns no search
				// metadata over the OpenAI-compatible protocol. See the `alibaba`
				// case: only a forced request searches, and it always does.
				if (
					usedProvider === "scx-ai-gp" &&
					webSearchRequested &&
					webSearchForced
				) {
					webSearchCount = 1;
				}
			}
			break;
	}

	if (splitTaggedReasoning && typeof content === "string") {
		const splitContent = splitReasoningFromTaggedContent(content);
		if (splitContent.reasoningContent) {
			content = splitContent.content;
			reasoningContent ??= splitContent.reasoningContent;
		}
	}

	// For non-reasoning models that return their answer in reasoning_content,
	// move reasoning to content so the response is visible.
	if (!supportsReasoning && !content && reasoningContent) {
		content = reasoningContent;
		reasoningContent = null;
	}

	completionTokens = normalizeCompletionTokens(
		promptTokens,
		completionTokens,
		reasoningTokens,
		totalTokens,
	);

	return {
		content,
		reasoningContent,
		reasoningDetails,
		messagePhase,
		messageBeforeToolCalls,
		messageItems,
		reasoningContext,
		finishReason,
		promptTokens,
		completionTokens,
		totalTokens,
		reasoningTokens,
		cachedTokens,
		cacheCreationTokens,
		cacheCreation5mTokens,
		cacheCreation1hTokens,
		imageInputTokens,
		imageOutputTokens,
		audioInputTokens,
		cachedAudioInputTokens,
		toolResults,
		anthropicNativeBlocks,
		images,
		annotations: annotations.length > 0 ? annotations : null,
		webSearchCount: webSearchCount > 0 ? webSearchCount : null,
	};
}
