import { HTTPException } from "hono/http-exception";

import { calculateCosts } from "@/lib/costs";
import { insertLog } from "@/lib/logs";

import { logger } from "@llmgateway/logger";
import {
	getProviderHeaders,
	type Model,
	type ModelDefinition,
	type Provider,
	type ProviderRequestBody,
} from "@llmgateway/models";

import type { ServerTypes } from "@/vars";
import type { InferSelectModel, Project, tables, ApiKey } from "@llmgateway/db";
import type { Context } from "hono";

export interface NonStreamingContext {
	c: Context<ServerTypes>;
	url: string;
	usedProvider: Provider;
	usedToken: string;
	requestBody: ProviderRequestBody;
	requestCanBeCanceled: boolean;
	logEntryData: any;
	startTime: number;
	finalModelInfo: ModelDefinition;
	project: Project;
	apiKey: ApiKey;
	providerKey?: InferSelectModel<typeof tables.providerKey>;
	usedModel: Model;
	usedModelMapping: Model;
	usedModelFormatted: string;
}

interface ImageObject {
	type: "image_url";
	image_url: {
		url: string;
	};
}

function getFinishReasonForError(status: number, _errorText: string): string {
	if (status >= 400 && status < 500) {
		return "client_error";
	}
	if (status >= 500) {
		return "server_error";
	}
	return "error";
}

function parseProviderResponse(
	usedProvider: Provider,
	json: any,
	_messages: any[] = [],
) {
	let content = null;
	let reasoningContent = null;
	let finishReason = null;
	let promptTokens = null;
	let completionTokens = null;
	let totalTokens = null;
	let reasoningTokens = null;
	let cachedTokens = null;
	let toolResults = null;
	let images: ImageObject[] = [];

	switch (usedProvider) {
		case "anthropic": {
			// Extract content and reasoning content from Anthropic response
			const contentBlocks = json.content || [];
			const textBlocks = contentBlocks.filter(
				(block: any) => block.type === "text",
			);
			const thinkingBlocks = contentBlocks.filter(
				(block: any) => block.type === "thinking",
			);

			content = textBlocks.map((block: any) => block.text).join("") || null;
			reasoningContent =
				thinkingBlocks.map((block: any) => block.thinking).join("") || null;

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
		}
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

			// Calculate totalTokens to include reasoning tokens for Google models
			if (promptTokens !== null) {
				totalTokens =
					promptTokens + (completionTokens || 0) + (reasoningTokens || 0);
			}

			// Extract tool calls from Google format
			toolResults =
				parts
					.filter((part: any) => part.functionCall)
					.map((part: any, index: number) => ({
						id: `${part.functionCall.name}_${json.candidates?.[0]?.index ?? 0}_${index}`,
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
					} catch {}
				}
			}

			// Extract tool calls from Mistral format (same as OpenAI)
			toolResults = json.choices?.[0]?.message?.tool_calls || null;
			break;
		default: // OpenAI format
			// Standard OpenAI chat completions format
			toolResults = json.choices?.[0]?.message?.tool_calls || null;
			content = json.choices?.[0]?.message?.content || null;
			// Extract reasoning content for reasoning-capable models
			reasoningContent =
				json.choices?.[0]?.message?.reasoning_content ||
				json.choices?.[0]?.message?.reasoning ||
				null;
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

			// Extract images from OpenAI-format response
			if (json.choices?.[0]?.message?.images) {
				images = json.choices[0].message.images;
			}
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
		images,
	};
}

function transformToOpenAIFormat(
	data: any,
	usedModel: string,
	usedProvider: Provider,
): any {
	// If it's already in OpenAI format, return as is
	if (data.choices && Array.isArray(data.choices)) {
		return {
			...data,
			model: usedModel,
		};
	}

	// Transform based on provider
	switch (usedProvider) {
		case "anthropic": {
			const response: any = {
				id: data.id || `chatcmpl-${Date.now()}`,
				object: "chat.completion",
				created: Math.floor(Date.now() / 1000),
				model: usedModel,
				choices: [
					{
						index: 0,
						message: {
							role: "assistant",
							content: null,
						},
						finish_reason: data.stop_reason || "stop",
					},
				],
				usage: {
					prompt_tokens: data.usage?.input_tokens || 0,
					completion_tokens: data.usage?.output_tokens || 0,
					total_tokens:
						(data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
				},
			};

			// Handle content blocks
			const contentBlocks = data.content || [];
			const textBlocks = contentBlocks.filter(
				(block: any) => block.type === "text",
			);
			const thinkingBlocks = contentBlocks.filter(
				(block: any) => block.type === "thinking",
			);

			response.choices[0].message.content =
				textBlocks.map((block: any) => block.text).join("") || null;

			// Add reasoning content if present
			if (thinkingBlocks.length > 0) {
				response.choices[0].message.reasoning_content = thinkingBlocks
					.map((block: any) => block.thinking)
					.join("");
			}

			// Handle tool calls
			const toolBlocks = contentBlocks.filter(
				(block: any) => block.type === "tool_use",
			);
			if (toolBlocks.length > 0) {
				response.choices[0].message.tool_calls = toolBlocks.map(
					(block: any) => ({
						id: block.id,
						type: "function",
						function: {
							name: block.name,
							arguments: JSON.stringify(block.input),
						},
					}),
				);
				response.choices[0].finish_reason = "tool_calls";
			}

			return response;
		}
		case "google-ai-studio": {
			const candidate = data.candidates?.[0];
			if (!candidate) {
				throw new Error("No candidate in Google AI response");
			}

			const response: any = {
				id: `chatcmpl-${Date.now()}`,
				object: "chat.completion",
				created: Math.floor(Date.now() / 1000),
				model: usedModel,
				choices: [
					{
						index: 0,
						message: {
							role: "assistant",
							content: null,
						},
						finish_reason: candidate.finishReason || "stop",
					},
				],
				usage: {
					prompt_tokens: data.usageMetadata?.promptTokenCount || 0,
					completion_tokens: data.usageMetadata?.candidatesTokenCount || 0,
					total_tokens:
						(data.usageMetadata?.promptTokenCount || 0) +
						(data.usageMetadata?.candidatesTokenCount || 0),
				},
			};

			// Handle parts
			const parts = candidate.content?.parts || [];
			const contentParts = parts.filter((part: any) => !part.thought);
			response.choices[0].message.content =
				contentParts.map((part: any) => part.text).join("") || null;

			return response;
		}
		default:
			// For other providers or already in OpenAI format
			return {
				...data,
				model: usedModel,
			};
	}
}

export async function handleNonStreamingResponse(
	context: NonStreamingContext,
): Promise<Response> {
	const {
		c,
		url,
		usedProvider,
		usedToken,
		requestBody,
		requestCanBeCanceled,
		logEntryData,
		startTime,
		finalModelInfo: _finalModelInfo,
		project,
		apiKey,
		providerKey,
		usedModel,
		usedModelMapping: _usedModelMapping,
		usedModelFormatted: _usedModelFormatted,
	} = context;

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
	let res: Response | undefined;
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
		await insertLog({
			...logEntryData,
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
		);
	}

	if (!res || !res.ok) {
		const errorResponseText = res ? await res.text() : "No response";
		const finishReason = getFinishReasonForError(
			res?.status || 500,
			errorResponseText,
		);

		// Log the error
		await insertLog({
			...logEntryData,
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
			errorDetails: {
				statusCode: res?.status || 500,
				statusText: res?.statusText || "Unknown Error",
				responseText: errorResponseText,
			},
			cachedInputCost: null,
			requestCost: null,
			estimatedCost: false,
			cached: false,
			toolResults: null,
		});

		// Return appropriate error response
		let errorData;
		if (finishReason === "client_error") {
			try {
				errorData = JSON.parse(errorResponseText);
			} catch {
				errorData = {
					error: {
						message: `Error from provider: ${res?.status || 500} ${res?.statusText || "Unknown Error"}`,
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
					message: `Error from provider: ${res?.status || 500} ${res?.statusText || "Unknown Error"}`,
					type: finishReason,
					param: null,
					code: finishReason,
				},
			};
		}

		throw new HTTPException((res?.status || 500) as any, {
			message: errorData.error?.message || "Provider error",
		});
	}

	const json = await res.json();
	const responseSize = JSON.stringify(json).length;

	// Parse the provider response
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
		images: _images,
	} = parseProviderResponse(usedProvider, json);

	// Calculate costs
	const costs = calculateCosts(
		usedModel,
		usedProvider,
		promptTokens || 0,
		completionTokens || 0,
		reasoningTokens || 0,
		cachedTokens || 0,
	);

	// Update database usage if using our credits
	if (!providerKey?.token && project.mode !== "api-keys") {
		try {
			// Note: This would need to be updated with correct database schema
			// await db.update(organizations).set({ credits: sql`credits - ${costs.totalCost}` }).where(eq(organizations.id, project.organizationId));
		} catch (error) {
			logger.error("Failed to update organization credits", {
				error: error instanceof Error ? error : new Error(String(error)),
				organizationId: project.organizationId,
				cost: costs.totalCost,
			});
		}

		try {
			// Note: This would need to be updated with correct database schema
			// await db.update(apiKeys).set({ usage: sql`usage + ${costs.totalCost}` }).where(eq(apiKeys.id, apiKey.id));
		} catch (error) {
			logger.error("Failed to update API key usage", {
				error: error instanceof Error ? error : new Error(String(error)),
				apiKeyId: apiKey.id,
				cost: costs.totalCost,
			});
		}
	}

	// Transform response to OpenAI format
	const transformedResponse = transformToOpenAIFormat(
		json,
		usedModel,
		usedProvider,
	);

	// Log the successful response
	await insertLog({
		...logEntryData,
		duration,
		responseSize,
		content,
		reasoningContent,
		finishReason,
		promptTokens: promptTokens?.toString() || null,
		completionTokens: completionTokens?.toString() || null,
		totalTokens: totalTokens?.toString() || null,
		reasoningTokens: reasoningTokens?.toString() || null,
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
		toolResults,
	});

	return c.json(transformedResponse);
}
