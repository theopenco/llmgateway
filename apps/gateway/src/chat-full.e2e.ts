import "dotenv/config";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/app.js";
import { imageModels, streamingImageModels } from "@/chat-helpers.e2e.js";
import {
	beforeAllHook,
	beforeEachHook,
	fullMode,
	generateTestRequestId,
	getConcurrentTestOptions,
	getTestOptions,
	logMode,
	testModels,
	validateLogByRequestId,
} from "@/chat-helpers.e2e.js";
import { readAll } from "@/test-utils/test-helpers.js";

import type { ProviderModelMapping } from "@llmgateway/models";

describe("e2e", getConcurrentTestOptions(), () => {
	beforeAll(beforeAllHook);

	beforeEach(beforeEachHook);

	test("empty", () => {
		expect(true).toBe(true);
	});

	if (fullMode) {
		test.each(imageModels)(
			"image output $model",
			getTestOptions(),
			async ({ model }) => {
				const requestId = generateTestRequestId();
				const res = await app.request("/v1/chat/completions", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						"x-request-id": requestId,
						Authorization: `Bearer real-token`,
					},
					body: JSON.stringify({
						model: model,
						messages: [
							{
								role: "user",
								content: "Generate an image of a cute dog",
							},
						],
					}),
				});

				const json = await res.json();
				if (logMode) {
					console.log("image output response:", JSON.stringify(json, null, 2));
				}

				expect(res.status).toBe(200);
				expect(json).toHaveProperty("choices");
				expect(json.choices).toHaveLength(1);
				expect(json.choices[0]).toHaveProperty("message");

				const message = json.choices[0].message;
				expect(message).toHaveProperty("role", "assistant");

				// Check that the response contains text content
				expect(message.content).toBeTruthy();
				expect(typeof message.content).toBe("string");

				// Check for images array in OpenAI format
				expect(message).toHaveProperty("images");
				expect(Array.isArray(message.images)).toBe(true);
				expect(message.images.length).toBeGreaterThan(0);

				// Validate each image object
				for (const image of message.images) {
					expect(image).toHaveProperty("type", "image_url");
					expect(image).toHaveProperty("image_url");
					expect(image.image_url).toHaveProperty("url");
					expect(typeof image.image_url.url).toBe("string");
					// Check if it's a base64 data URL
					expect(image.image_url.url).toMatch(
						/^data:image\/(png|jpeg|jpg|webp);base64,/,
					);
				}

				// Validate logs
				const log = await validateLogByRequestId(requestId);
				expect(log.streamed).toBe(false);

				// Validate usage
				expect(json).toHaveProperty("usage");
				expect(json.usage).toHaveProperty("prompt_tokens");
				expect(json.usage).toHaveProperty("completion_tokens");
				expect(json.usage).toHaveProperty("total_tokens");
			},
		);

		test.each(streamingImageModels)(
			"streaming image output $model",
			getTestOptions(),
			async ({ model }) => {
				const requestId = generateTestRequestId();
				const res = await app.request("/v1/chat/completions", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						"x-request-id": requestId,
						Authorization: `Bearer real-token`,
					},
					body: JSON.stringify({
						model: model,
						messages: [
							{
								role: "user",
								content: "Generate an image of a cute dog",
							},
						],
						stream: true,
					}),
				});

				if (res.status !== 200) {
					console.log("response:", await res.text());
					throw new Error(`Request failed with status ${res.status}`);
				}

				expect(res.status).toBe(200);
				expect(res.headers.get("content-type")).toContain("text/event-stream");

				const streamResult = await readAll(res.body);
				if (logMode) {
					console.log(
						"streaming image result:",
						JSON.stringify(streamResult, null, 2),
					);
				}

				expect(streamResult.hasValidSSE).toBe(true);
				expect(streamResult.eventCount).toBeGreaterThan(0);
				expect(streamResult.hasContent).toBe(true);

				// Verify that all streaming responses are transformed to OpenAI format
				expect(streamResult.hasOpenAIFormat).toBe(true);

				// Look for chunks containing images
				const imageChunks = streamResult.chunks.filter(
					(chunk) => chunk.choices?.[0]?.delta?.images,
				);
				expect(imageChunks.length).toBeGreaterThan(0);

				// Validate image chunks
				for (const chunk of imageChunks) {
					expect(chunk).toHaveProperty("id");
					expect(chunk).toHaveProperty("object", "chat.completion.chunk");
					expect(chunk).toHaveProperty("created");
					expect(chunk).toHaveProperty("model");
					expect(chunk).toHaveProperty("choices");
					expect(chunk.choices).toHaveLength(1);
					expect(chunk.choices[0]).toHaveProperty("index", 0);
					expect(chunk.choices[0]).toHaveProperty("delta");

					const delta = chunk.choices[0].delta;
					if (delta.images) {
						expect(Array.isArray(delta.images)).toBe(true);
						for (const image of delta.images) {
							expect(image).toHaveProperty("type", "image_url");
							expect(image).toHaveProperty("image_url");
							expect(image.image_url).toHaveProperty("url");
							expect(typeof image.image_url.url).toBe("string");
							// Check if it's a base64 data URL
							expect(image.image_url.url).toMatch(
								/^data:image\/(png|jpeg|jpg|webp);base64,/,
							);
						}
					}
				}

				// Verify that usage object is returned in streaming mode
				const usageChunks = streamResult.chunks.filter(
					(chunk) =>
						chunk.usage &&
						(chunk.usage.prompt_tokens !== null ||
							chunk.usage.completion_tokens !== null ||
							chunk.usage.total_tokens !== null),
				);
				expect(usageChunks.length).toBeGreaterThan(0);

				const log = await validateLogByRequestId(requestId);
				expect(log.streamed).toBe(true);
			},
		);
	}

	if (fullMode) {
		const reasoningToolCallModels = testModels.filter((m) =>
			m.providers.some(
				(p: ProviderModelMapping) => p.reasoning === true && p.tools === true,
			),
		);

		test.each(reasoningToolCallModels)(
			"reasoning + tool calls $model",
			getTestOptions(),
			async ({ model, providers }) => {
				const requestId = generateTestRequestId();
				const res = await app.request("/v1/chat/completions", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						"x-request-id": requestId,
						Authorization: `Bearer real-token`,
					},
					body: JSON.stringify({
						model: model,
						messages: [
							{
								role: "system",
								content:
									"You are a weather assistant that can get weather information for cities. Think step by step and use tools when needed.",
							},
							{
								role: "user",
								content:
									"What's the weather like in San Francisco? Consider all the exact details. Use the weather tool and explain your reasoning.",
							},
						],
						tools: [
							{
								type: "function",
								function: {
									name: "get_weather",
									description: "Get the current weather for a given city",
									parameters: {
										type: "object",
										properties: {
											city: {
												type: "string",
												description: "The city name to get weather for",
											},
											unit: {
												type: "string",
												enum: ["celsius", "fahrenheit"],
												description: "Temperature unit",
												default: "fahrenheit",
											},
										},
										required: ["city"],
									},
								},
							},
						],
						tool_choice: "auto",
						reasoning_effort: "medium",
					}),
				});

				const json = await res.json();
				if (logMode) {
					console.log(
						"reasoning + tool calls response:",
						JSON.stringify(json, null, 2),
					);
				}

				expect(res.status).toBe(200);
				expect(json).toHaveProperty("choices");
				expect(json.choices).toHaveLength(1);
				expect(json.choices[0]).toHaveProperty("message");

				const message = json.choices[0].message;
				expect(message).toHaveProperty("role", "assistant");

				// Should have tool calls since we're asking about weather
				expect(message).toHaveProperty("tool_calls");
				expect(Array.isArray(message.tool_calls)).toBe(true);
				expect(message.tool_calls.length).toBeGreaterThan(0);

				// Validate tool call structure
				const toolCall = message.tool_calls[0];
				expect(toolCall).toHaveProperty("id");
				expect(toolCall).toHaveProperty("type", "function");
				expect(toolCall).toHaveProperty("function");
				expect(toolCall.function).toHaveProperty("name", "get_weather");
				expect(toolCall.function).toHaveProperty("arguments");

				// Parse and validate arguments
				const args = JSON.parse(toolCall.function.arguments);
				expect(args).toHaveProperty("city");
				expect(typeof args.city).toBe("string");
				expect(args.city.toLowerCase()).toContain("san francisco");

				// Check finish reason
				expect(json.choices[0]).toHaveProperty("finish_reason", "tool_calls");

				// Check for reasoning content - only if the provider expects reasoning output
				const reasoningProvider = providers?.find(
					(p: ProviderModelMapping) => p.reasoning === true,
				);
				if (
					(reasoningProvider as ProviderModelMapping)?.reasoningOutput !==
					"omit"
				) {
					expect(json.choices[0].message).toHaveProperty("reasoning_content");
					expect(typeof json.choices[0].message.reasoning_content).toBe(
						"string",
					);
					expect(
						json.choices[0].message.reasoning_content.length,
					).toBeGreaterThan(0);
				}

				// Validate logs
				const log = await validateLogByRequestId(requestId);
				expect(log.streamed).toBe(false);

				// Validate usage
				expect(json).toHaveProperty("usage");
				expect(json.usage).toHaveProperty("prompt_tokens");
				expect(json.usage).toHaveProperty("completion_tokens");
				expect(json.usage).toHaveProperty("total_tokens");
				expect(typeof json.usage.prompt_tokens).toBe("number");
				expect(typeof json.usage.completion_tokens).toBe("number");
				expect(typeof json.usage.total_tokens).toBe("number");
				expect(json.usage.prompt_tokens).toBeGreaterThan(0);
				expect(json.usage.completion_tokens).toBeGreaterThan(0);
				expect(json.usage.total_tokens).toBeGreaterThan(0);

				// Check for reasoning tokens if available
				if (json.usage.reasoning_tokens !== undefined) {
					expect(typeof json.usage.reasoning_tokens).toBe("number");
					expect(json.usage.reasoning_tokens).toBeGreaterThanOrEqual(0);
				}
			},
		);
	}
});
