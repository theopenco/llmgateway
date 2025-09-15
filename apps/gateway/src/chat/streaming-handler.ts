import { streamSSE } from "hono/streaming";

import { insertLog } from "@/lib/logs";

import { logger } from "@llmgateway/logger";
import { getProviderHeaders } from "@llmgateway/models";

import type { ServerTypes } from "@/vars";
import type { ProviderRequestBody, Provider } from "@llmgateway/models";
import type { Context } from "hono";

export interface StreamingContext {
	c: Context<ServerTypes>;
	url: string;
	usedProvider: Provider;
	usedToken: string;
	requestBody: ProviderRequestBody;
	requestCanBeCanceled: boolean;
	cachingEnabled: boolean;
	streamingCacheKey: string | null;
	debugMode: boolean;
	MAX_RAW_DATA_SIZE: number;
	logEntryData: any; // Base log entry data
	startTime: number;
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

function extractContentFromProvider(data: any, provider: Provider): string {
	switch (provider) {
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

function extractReasoningContentFromProvider(
	data: any,
	provider: Provider,
): string {
	switch (provider) {
		case "anthropic": {
			// Handle Anthropic thinking content blocks in streaming format
			if (
				data.type === "content_block_delta" &&
				data.delta?.type === "thinking_delta" &&
				data.delta?.thinking
			) {
				// This is a thinking delta - return the thinking content
				return data.delta.thinking;
			}
			return "";
		}
		case "google-ai-studio": {
			const parts = data.candidates?.[0]?.content?.parts || [];
			const reasoningParts = parts.filter((part: any) => part.thought);
			return reasoningParts.map((part: any) => part.text).join("") || "";
		}
		default: // OpenAI format
			return (
				data.choices?.[0]?.delta?.reasoning_content ||
				data.choices?.[0]?.delta?.reasoning ||
				""
			);
	}
}

export async function handleStreamingResponse(context: StreamingContext) {
	const {
		c,
		url,
		usedProvider,
		usedToken,
		requestBody,
		requestCanBeCanceled,
		cachingEnabled,
		streamingCacheKey,
		debugMode,
		MAX_RAW_DATA_SIZE,
		logEntryData,
		startTime,
	} = context;

	return streamSSE(c, async (stream) => {
		let eventId = 0;
		let canceled = false;
		let streamingError: unknown = null;

		// Raw logging variables
		let streamingRawResponseData = ""; // Raw SSE data sent back to the client

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

			// Collect raw response data for logging only in debug mode and within size limit
			if (debugMode && streamingRawResponseData.length < MAX_RAW_DATA_SIZE) {
				const sseString = `${sseData.event ? `event: ${sseData.event}\n` : ""}data: ${sseData.data}${sseData.id ? `\nid: ${sseData.id}` : ""}\n\n`;
				streamingRawResponseData += sseString;
			}

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
				await insertLog({
					...logEntryData,
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
			logger.error("Provider error", {
				status: res.status,
				errorText: errorResponseText,
			});

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
			await insertLog({
				...logEntryData,
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
		let rawUpstreamData = ""; // Raw data received from upstream provider
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
				// Collect raw upstream data for logging only in debug mode and within size limit
				if (debugMode && rawUpstreamData.length < MAX_RAW_DATA_SIZE) {
					rawUpstreamData += chunk;
				}

				// Check buffer size to prevent memory exhaustion
				if (buffer.length > MAX_BUFFER_SIZE) {
					logger.warn(
						"Buffer size exceeded 10MB, clearing buffer to prevent memory exhaustion",
					);
					buffer = "";
					continue;
				}

				// Process streaming chunks... (simplified for brevity)
				// Note: The actual implementation would contain the full streaming parsing logic
				// This is a placeholder to demonstrate the structure

				// Basic SSE parsing - in real implementation this would be much more complex
				const lines = buffer.split("\n");
				buffer = lines.pop() || ""; // Keep incomplete line in buffer

				for (const line of lines) {
					if (line.startsWith("data: ")) {
						const data = line.slice(6);
						if (data === "[DONE]") {
							await writeSSEAndCache({
								data: "[DONE]",
								id: String(eventId++),
							});
							continue;
						}

						try {
							const parsed = JSON.parse(data);

							// Extract content and other fields
							const content = extractContentFromProvider(parsed, usedProvider);
							const reasoningContent = extractReasoningContentFromProvider(
								parsed,
								usedProvider,
							);

							if (content) {
								fullContent += content;
							}
							if (reasoningContent) {
								fullReasoningContent += reasoningContent;
							}

							// Extract usage information
							if (parsed.usage) {
								promptTokens = parsed.usage.prompt_tokens || promptTokens;
								completionTokens =
									parsed.usage.completion_tokens || completionTokens;
								totalTokens = parsed.usage.total_tokens || totalTokens;
								reasoningTokens =
									parsed.usage.reasoning_tokens || reasoningTokens;
								cachedTokens =
									parsed.usage.prompt_tokens_details?.cached_tokens ||
									cachedTokens;
							}

							// Extract finish reason
							if (parsed.choices?.[0]?.finish_reason) {
								finishReason = parsed.choices[0].finish_reason;
							}

							// Extract tool calls
							if (parsed.choices?.[0]?.delta?.tool_calls) {
								streamingToolCalls = parsed.choices[0].delta.tool_calls;
							}

							await writeSSEAndCache({
								data: data,
								id: String(eventId++),
							});
						} catch (_e) {
							// Skip malformed JSON
							logger.warn("Failed to parse streaming chunk", { data });
						}
					}
				}
			}
		} catch (error) {
			streamingError = error;
			logger.error(
				"Streaming error",
				error instanceof Error ? error : new Error(String(error)),
			);
			await writeSSEAndCache({
				data: JSON.stringify({ error: "Streaming failed" }),
				event: "error",
				id: String(eventId++),
			});
		} finally {
			// Clean up event listeners
			c.req.raw.signal.removeEventListener("abort", onAbort);

			// Log final response
			await insertLog({
				...logEntryData,
				duration: Date.now() - startTime,
				responseSize: streamingRawResponseData.length,
				content: fullContent || null,
				reasoningContent: fullReasoningContent || null,
				finishReason,
				promptTokens: promptTokens?.toString() || null,
				completionTokens: completionTokens?.toString() || null,
				totalTokens: totalTokens?.toString() || null,
				reasoningTokens: reasoningTokens?.toString() || null,
				cachedTokens: cachedTokens?.toString() || null,
				hasError: !!streamingError,
				streamed: true,
				canceled,
				errorDetails: streamingError ? { error: String(streamingError) } : null,
				cached: false,
				toolResults: streamingToolCalls,
			});
		}
	});
}
