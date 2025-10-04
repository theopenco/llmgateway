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
	streamingModels,
	validateLogByRequestId,
} from "@/chat-helpers.e2e.js";
import { readAll } from "@/test-utils/test-helpers.js";

describe("e2e", getConcurrentTestOptions(), () => {
	beforeAll(beforeAllHook);

	beforeEach(beforeEachHook);

	test("empty", () => {
		expect(true).toBe(true);
	});

	test.each(streamingModels)(
		"/v1/chat/completions streaming with $model",
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
							content: "Hello! This is a streaming e2e test.",
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
				console.log("streamResult", JSON.stringify(streamResult, null, 2));
			}

			expect(streamResult.hasValidSSE).toBe(true);
			expect(streamResult.eventCount).toBeGreaterThan(0);
			expect(streamResult.hasContent).toBe(true);

			// Verify that all streaming responses are transformed to OpenAI format
			expect(streamResult.hasOpenAIFormat).toBe(true);

			// Verify that chunks have the correct OpenAI streaming format
			const contentChunks = streamResult.chunks.filter(
				(chunk) => chunk.choices?.[0]?.delta?.content,
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
				expect(chunk.choices[0]).toHaveProperty("index", 0);
				expect(chunk.choices[0]).toHaveProperty("delta");
				expect(chunk.choices[0]).toHaveProperty("delta.role", "assistant");
				expect(chunk.choices[0].delta).toHaveProperty("content");
				expect(typeof chunk.choices[0].delta.content).toBe("string");
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

			const log = await validateLogByRequestId(requestId);
			expect(log.streamed).toBe(true);
			expect(log.content).toBeTruthy();
			expect(log.content).not.toBeNull();
			expect(typeof log.content).toBe("string");

			// expect(log.cost).not.toBeNull();
			// expect(log.cost).toBeGreaterThanOrEqual(0);
		},
	);
});
