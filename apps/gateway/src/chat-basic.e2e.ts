import "dotenv/config";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";

import {
	beforeAllHook,
	beforeEachHook,
	getConcurrentTestOptions,
	getTestOptions,
	logMode,
	providerModels,
	testModels,
	validateLogByRequestId,
	validateResponse,
} from "@/chat-helpers.e2e.js";

import { models } from "@llmgateway/models";

import { app } from "./app.js";

import type { ProviderModelMapping } from "@llmgateway/models";

// Helper function to generate unique request IDs for tests
export function generateTestRequestId(): string {
	return `test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

describe("e2e", getConcurrentTestOptions(), () => {
	beforeAll(beforeAllHook);

	beforeEach(beforeEachHook);

	test.each(testModels)(
		"completions $model",
		getTestOptions(),
		async ({ model, originalModel }) => {
			// Use a long prompt to trigger caching mechanism (1024+ tokens) for models that support it
			const longPrompt = `You are a helpful assistant. Please analyze the following long text carefully and provide insights. ${"This is a very detailed example text that needs to be quite long to trigger caching mechanisms which require at least 1024 tokens. ".repeat(50)} Just reply 'OK' after processing this text.`;

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
							content: longPrompt,
						},
						{
							role: "user",
							content: "Hello, just reply 'OK'!",
						},
					],
				}),
			});

			const json = await res.json();
			if (logMode) {
				console.log("response:", JSON.stringify(json, null, 2));
			}

			expect(res.status).toBe(200);
			validateResponse(json);

			const log = await validateLogByRequestId(requestId);
			expect(log.streamed).toBe(false);

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

			// expect(log.inputCost).not.toBeNull();
			// expect(log.outputCost).not.toBeNull();
			// expect(log.cost).not.toBeNull();

			const originalModelProviderMapping = models
				.find((m) => m.id === originalModel)
				?.providers.find(
					(p) => p.providerId === log.usedProvider,
				) as ProviderModelMapping;
			if (originalModelProviderMapping.cachedInputPrice) {
				// for models that support cached input cost, make the same request twice with a long prompt (1024+ tokens) to trigger caching
				const secondRequestId = generateTestRequestId();
				const secondRes = await app.request("/v1/chat/completions", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						"x-request-id": secondRequestId,
						Authorization: `Bearer real-token`,
					},
					body: JSON.stringify({
						model: model,
						messages: [
							{
								role: "system",
								content: longPrompt,
							},
							{
								role: "user",
								content: "Hello, just reply 'OK'!",
							},
						],
					}),
				});
				const secondJson = await secondRes.json();
				if (logMode) {
					console.log("second response:", JSON.stringify(secondJson, null, 2));
				}
				const secondLog = await validateLogByRequestId(secondRequestId);
				console.log("Second request log for caching test:", {
					cachedInputCost: secondLog.cachedInputCost,
					cachedTokens: secondLog.cachedTokens,
					provider: log.usedProvider,
					inputCost: secondLog.inputCost,
					totalCost: secondLog.cost,
				});

				expect(secondLog.cachedInputCost).toBeGreaterThan(0);
			}
		},
	);

	if (process.env.EXPERIMENTAL) {
		test.each(providerModels)(
			"complex $model",
			getTestOptions(),
			async ({ model, provider }) => {
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
								content: [
									{
										type: "text",
										text: "<task>\ndescribe this image\n</task>",
									},
									{
										type: "text",
										text: "", // empty text – note this may need special handling
									},
									// provide image url if vision is supported
									...(provider.vision
										? [
												{
													type: "image_url",
													image_url: {
														url: "https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://google.com&size=128",
													},
												},
											]
										: []),
								],
							},
						],
					}),
				});

				const json = await res.json();
				if (logMode) {
					console.log("response:", JSON.stringify(json, null, 2));
				}

				expect(res.status).toBe(200);
				validateResponse(json);

				const log = await validateLogByRequestId(requestId);
				expect(log.streamed).toBe(false);

				expect(json).toHaveProperty("usage");
				expect(json.usage).toHaveProperty("prompt_tokens");
				expect(json.usage).toHaveProperty("completion_tokens");
				expect(json.usage).toHaveProperty("total_tokens");
				expect(typeof json.usage.prompt_tokens).toBe("number");
				expect(typeof json.usage.completion_tokens).toBe("number");
				expect(typeof json.usage.total_tokens).toBe("number");
				if (provider.providerId !== "zai") {
					// zai may have weird prompt tokens
					expect(json.usage.prompt_tokens).toBeGreaterThan(0);
				}
				expect(json.usage.completion_tokens).toBeGreaterThan(0);
				expect(json.usage.total_tokens).toBeGreaterThan(0);
				expect(json.usage.total_tokens).toEqual(
					json.usage.prompt_tokens +
						json.usage.completion_tokens +
						(json.usage.reasoning_tokens || 0),
				);
			},
		);

		test.each(testModels)(
			"parameters $model",
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
								role: "system",
								content: "You are a helpful assistant.",
							},
							{
								role: "user",
								content: "Hello, just reply 'OK'!",
							},
						],
						max_tokens: 200,
						temperature: 0.7,
					}),
				});

				const json = await res.json();
				if (logMode) {
					console.log("parameters response:", JSON.stringify(json, null, 2));
				}

				expect(res.status).toBe(200);
				validateResponse(json);

				const log = await validateLogByRequestId(requestId);
				expect(log.streamed).toBe(false);

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
			},
		);
	}
});
