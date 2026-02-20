import "dotenv/config";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/app.js";
import {
	beforeAllHook,
	beforeEachHook,
	generateTestRequestId,
	getConcurrentTestOptions,
	logMode,
	streamingWebSearchModels,
	validateLogByRequestId,
	webSearchModels,
} from "@/chat-helpers.e2e.js";
import { readAll } from "@/test-utils/test-helpers.js";

const testWebSearch = process.env.TEST_WEB_SEARCH;

// Skip all tests if TEST_WEB_SEARCH is not set
const describeWebSearch = testWebSearch ? describe : describe.skip;

describeWebSearch("e2e web search", getConcurrentTestOptions(), () => {
	beforeAll(beforeAllHook);

	beforeEach(beforeEachHook);

	test("empty", () => {
		expect(true).toBe(true);
	});

	test.each(webSearchModels)(
		"web search non-streaming $model",
		{ timeout: 300000 }, // Increase timeout for web search
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
							content:
								"Search the web for the latest news about artificial intelligence from today. What are the top stories?",
						},
					],
					tools: [
						{
							type: "web_search",
						},
					],
				}),
			});

			const json = await res.json();
			if (logMode) {
				console.log("web search response:", JSON.stringify(json, null, 2));
			}

			expect(res.status).toBe(200);
			expect(json).toHaveProperty("choices");
			expect(json.choices).toHaveLength(1);
			expect(json.choices[0]).toHaveProperty("message");

			const message = json.choices[0].message;
			expect(message).toHaveProperty("role", "assistant");
			expect(message).toHaveProperty("content");
			expect(typeof message.content).toBe("string");
			expect(message.content.length).toBeGreaterThan(0);

			// Validate logs
			const log = await validateLogByRequestId(requestId);
			expect(log.streamed).toBe(false);

			// Verify web search was used and cost is tracked
			expect(log).toHaveProperty("webSearchCost");
			expect(typeof log.webSearchCost).toBe("number");
			expect(log.webSearchCost).toBeGreaterThan(0);

			// Verify annotations (citations) are present
			expect(message).toHaveProperty("annotations");
			expect(Array.isArray(message.annotations)).toBe(true);
			expect(message.annotations.length).toBeGreaterThan(0);

			// Validate annotation structure
			const citation = message.annotations[0];
			expect(citation).toHaveProperty("type", "url_citation");
			expect(citation).toHaveProperty("url_citation");
			expect(citation.url_citation).toHaveProperty("url");
			expect(typeof citation.url_citation.url).toBe("string");
			expect(citation.url_citation.url).toMatch(/^https?:\/\//);

			if (logMode) {
				console.log(
					`Web search was used for ${model}, cost: ${log.webSearchCost}`,
				);
			}

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
		},
	);

	test.each(streamingWebSearchModels)(
		"web search streaming $model",
		{ timeout: 180000 }, // Increase timeout for web search
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
							content:
								"Search the web for the latest news about artificial intelligence from today. What are the top stories?",
						},
					],
					tools: [
						{
							type: "web_search",
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

			// Validate logs
			const log = await validateLogByRequestId(requestId);
			expect(log.streamed).toBe(true);

			// Verify web search was used and cost is tracked
			expect(log).toHaveProperty("webSearchCost");
			expect(typeof log.webSearchCost).toBe("number");
			expect(log.webSearchCost).toBeGreaterThan(0);

			// Verify annotations (citations) are present in at least one chunk
			const annotationChunks = streamResult.chunks.filter(
				(chunk) => chunk.choices?.[0]?.delta?.annotations,
			);
			expect(annotationChunks.length).toBeGreaterThan(0);

			// Validate annotation structure in streaming
			const firstAnnotationChunk = annotationChunks[0];
			const annotations =
				firstAnnotationChunk.choices[0].delta.annotations ?? [];
			expect(Array.isArray(annotations)).toBe(true);
			expect(annotations.length).toBeGreaterThan(0);

			// Validate citation structure
			const citation = annotations[0];
			expect(citation).toHaveProperty("type", "url_citation");
			expect(citation).toHaveProperty("url_citation");
			expect(citation.url_citation).toHaveProperty("url");
			expect(typeof citation.url_citation.url).toBe("string");
			expect(citation.url_citation.url).toMatch(/^https?:\/\//);

			if (logMode) {
				console.log(
					`Web search was used for ${model}, cost: ${log.webSearchCost}`,
				);
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

			// Validate usage structure
			const lastUsageChunk = usageChunks[usageChunks.length - 1];
			expect(lastUsageChunk.usage).toHaveProperty("prompt_tokens");
			expect(lastUsageChunk.usage).toHaveProperty("completion_tokens");
			expect(lastUsageChunk.usage).toHaveProperty("total_tokens");
			expect(typeof lastUsageChunk.usage.prompt_tokens).toBe("number");
			expect(typeof lastUsageChunk.usage.completion_tokens).toBe("number");
			expect(typeof lastUsageChunk.usage.total_tokens).toBe("number");
			expect(lastUsageChunk.usage.prompt_tokens).toBeGreaterThan(0);
			expect(lastUsageChunk.usage.completion_tokens).toBeGreaterThan(0);
			expect(lastUsageChunk.usage.total_tokens).toBeGreaterThan(0);
		},
	);
});
