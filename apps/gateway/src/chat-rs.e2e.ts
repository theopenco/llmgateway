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
	streamingReasoningModels,
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

	test.each(streamingReasoningModels)(
		"reasoning + streaming $model",
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
								"You are a helpful assistant. Think step by step and show your reasoning.",
						},
						{
							role: "user",
							content:
								"Solve this logic puzzle: If all roses are flowers, and some flowers are red, what can we conclude about roses? Think through this step by step.",
						},
					],
					reasoning_effort: "medium",
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
					"reasoning streaming response:",
					JSON.stringify(streamResult.chunks, null, 2),
				);
			}

			expect(streamResult.hasValidSSE).toBe(true);
			expect(streamResult.eventCount).toBeGreaterThan(0);
			expect(streamResult.hasContent).toBe(true);

			// Verify that all streaming responses are transformed to OpenAI format
			expect(streamResult.hasOpenAIFormat).toBe(true);

			// Verify that chunks have the correct OpenAI streaming format
			const contentChunks = streamResult.chunks.filter(
				(chunk: any) => chunk.choices?.[0]?.delta?.content,
			);
			expect(contentChunks.length).toBeGreaterThan(0);

			// Verify each content chunk has proper OpenAI format
			for (const chunk of contentChunks) {
				expect(chunk).toHaveProperty("id");
				expect(chunk).toHaveProperty("object", "chat.completion.chunk");
				expect(chunk).toHaveProperty("created");
				expect(chunk).toHaveProperty("model");
				expect(chunk).toHaveProperty("choices");
				expect(chunk.choices).toHaveLength(1);
				expect(chunk.choices[0]).toHaveProperty("delta");
				expect(typeof chunk.choices[0].delta.content).toBe("string");
			}

			// Verify that usage object is returned in streaming mode
			const usageChunks = streamResult.chunks.filter(
				(chunk: any) =>
					chunk.usage &&
					(chunk.usage.prompt_tokens !== null ||
						chunk.usage.completion_tokens !== null ||
						chunk.usage.total_tokens !== null),
			);
			expect(usageChunks.length).toBeGreaterThan(0);

			// Verify the usage chunk has proper format
			const usageChunk = usageChunks[usageChunks.length - 1]; // Get the last usage chunk
			expect(usageChunk).toHaveProperty("usage");
			expect(usageChunk.usage).toHaveProperty("prompt_tokens");
			expect(usageChunk.usage).toHaveProperty("completion_tokens");
			expect(usageChunk.usage).toHaveProperty("total_tokens");
			expect(typeof usageChunk.usage.prompt_tokens).toBe("number");
			expect(typeof usageChunk.usage.completion_tokens).toBe("number");
			expect(typeof usageChunk.usage.total_tokens).toBe("number");
			expect(usageChunk.usage.prompt_tokens).toBeGreaterThan(0);
			expect(usageChunk.usage.completion_tokens).toBeGreaterThan(0);
			expect(usageChunk.usage.total_tokens).toBeGreaterThan(0);

			// Check for reasoning tokens if available
			if (usageChunk.usage.reasoning_tokens !== undefined) {
				expect(typeof usageChunk.usage.reasoning_tokens).toBe("number");
				expect(usageChunk.usage.reasoning_tokens).toBeGreaterThanOrEqual(0);
			}

			// Determine if we should check for reasoning output
			const reasoningProvider = providers?.find(
				(p: ProviderModelMapping) => p.reasoning === true,
			) as ProviderModelMapping;
			const useResponsesApi = process.env.USE_RESPONSES_API === "true";
			const isOpenAI = reasoningProvider?.providerId === "openai";
			const shouldCheckReasoning =
				reasoningProvider?.reasoningOutput !== "omit" &&
				(!isOpenAI || useResponsesApi);

			// Verify reasoning content is present in unified reasoning field in streaming chunks
			if (shouldCheckReasoning) {
				const reasoningChunks = streamResult.chunks.filter(
					(chunk: any) =>
						chunk.choices?.[0]?.delta?.reasoning &&
						chunk.choices[0].delta.reasoning.length > 0,
				);
				expect(reasoningChunks.length).toBeGreaterThan(0);
			}

			const log = await validateLogByRequestId(requestId);
			expect(log.streamed).toBe(true);

			// Verify reasoning content is saved to database for reasoning models
			if (shouldCheckReasoning) {
				expect(log.reasoningContent).toBeTruthy();
				expect(log.reasoningContent).not.toBeNull();
				expect(typeof log.reasoningContent).toBe("string");
				if (log.reasoningContent) {
					expect(log.reasoningContent.length).toBeGreaterThan(0);
				}
			}
		},
	);
});
