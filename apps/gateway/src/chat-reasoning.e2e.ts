import "dotenv/config";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/app.js";
import {
	beforeAllHook,
	beforeEachHook,
	generateTestRequestId,
	getConcurrentTestOptions,
	getTestOptions,
	logMode,
	reasoningModels,
	validateLogByRequestId,
	validateResponse,
} from "@/chat-helpers.e2e.js";

import type { ProviderModelMapping } from "@llmgateway/models";

describe("e2e", getConcurrentTestOptions(), () => {
	beforeAll(beforeAllHook);

	beforeEach(beforeEachHook);

	test.each(reasoningModels)(
		"reasoning $model",
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
							content: "You are a helpful assistant.",
						},
						{
							role: "user",
							content: "What is 2/3 + 1/4 + 5/6?",
						},
					],
					reasoning_effort: "medium",
				}),
			});

			const json = await res.json();
			if (logMode) {
				console.log("reasoning response:", JSON.stringify(json, null, 2));
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

			// Check for reasoning tokens if available
			if (json.usage.reasoning_tokens !== undefined) {
				expect(typeof json.usage.reasoning_tokens).toBe("number");
				expect(json.usage.reasoning_tokens).toBeGreaterThanOrEqual(0);
			}

			// check for reasoning response - only if the provider expects reasoning output
			const reasoningProvider = providers?.find(
				(p: ProviderModelMapping) => p.reasoning === true,
			) as ProviderModelMapping;
			const useResponsesApi = process.env.USE_RESPONSES_API === "true";
			const isOpenAI = reasoningProvider?.providerId === "openai";
			// only enforce reasoning_content checks for where reasoningOutput is not "omit" and for openai, only if the responses api is used
			if (
				reasoningProvider?.reasoningOutput !== "omit" &&
				(!isOpenAI || useResponsesApi)
			) {
				expect(json.choices[0].message).toHaveProperty("reasoning_content");
			}
		},
	);
});
