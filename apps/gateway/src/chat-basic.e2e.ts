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

import { app } from "./app.js";

// Helper function to generate unique request IDs for tests
export function generateTestRequestId(): string {
	return `test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

describe("e2e", getConcurrentTestOptions(), () => {
	beforeAll(beforeAllHook);

	beforeEach(beforeEachHook);

	test("empty", () => {
		expect(true).toBe(true);
	});

	test.each(testModels)(
		"basic completions $model",
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
