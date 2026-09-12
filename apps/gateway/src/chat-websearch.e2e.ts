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

import { createWebSearchVerificationRequest } from "@llmgateway/actions";

const testWebSearch = process.env.TEST_WEB_SEARCH;

// Skip all tests if TEST_WEB_SEARCH is not set
const describeWebSearch = testWebSearch ? describe : describe.skip;

// DashScope's OpenAI-compatible protocol does not return search sources at all
// (no `search_info`, regardless of enable_source/enable_citation), so the
// providers backed by it can report that a search ran but never where it read.
const providersWithoutWebSearchAnnotations = ["zai/", "alibaba/", "scx-ai-gp/"];

// Every case here asserts that a search actually ran, so every case demands
// one. Providers that elect their own searches are unaffected — the directive
// is not forwarded to them — but mappings flagged `webSearchForcedOnly` are
// only routable with it, and would otherwise be filtered out of these tests.
const FORCE_WEB_SEARCH = { type: "web_search" } as const;

const expectsWebSearchAnnotations = (model: string) =>
	!providersWithoutWebSearchAnnotations.some((prefix) =>
		model.startsWith(prefix),
	);

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
					"x-no-fallback": "true",
					Authorization: `Bearer real-token`,
				},
				body: JSON.stringify(createWebSearchVerificationRequest(model)),
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

			if (expectsWebSearchAnnotations(model)) {
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
			}

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

	test.each(webSearchModels)(
		"web search responses api $model",
		{ timeout: 300000 }, // Increase timeout for web search
		async ({ model }) => {
			const requestId = generateTestRequestId();
			const res = await app.request("/v1/responses", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"x-request-id": requestId,
					"x-no-fallback": "true",
					Authorization: `Bearer real-token`,
				},
				body: JSON.stringify({
					model: model,
					input:
						"Search the web for the latest news about artificial intelligence from today. What are the top stories?",
					tools: [
						{
							type: "web_search",
						},
					],
					tool_choice: FORCE_WEB_SEARCH,
				}),
			});

			const json = await res.json();
			if (logMode) {
				console.log(
					"web search responses api response:",
					JSON.stringify(json, null, 2),
				);
			}

			expect(res.status).toBe(200);
			expect(json).toHaveProperty("output");
			expect(Array.isArray(json.output)).toBe(true);

			const message = json.output.find(
				(item: { type: string }) => item.type === "message",
			);
			expect(message).toBeDefined();
			const text = (message.content ?? [])
				.filter(
					(c: { type: string; text?: string }) => c.type === "output_text",
				)
				.map((c: { text?: string }) => c.text ?? "")
				.join("");
			expect(text.length).toBeGreaterThan(0);

			// Validate logs
			const log = await validateLogByRequestId(requestId);

			// Verify web search was used and cost is tracked
			expect(log).toHaveProperty("webSearchCost");
			expect(typeof log.webSearchCost).toBe("number");
			expect(log.webSearchCost).toBeGreaterThan(0);

			if (logMode) {
				console.log(
					`Web search was used for ${model} via responses api, cost: ${log.webSearchCost}`,
				);
			}
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
					"x-no-fallback": "true",
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
					tool_choice: FORCE_WEB_SEARCH,
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

			if (expectsWebSearchAnnotations(model)) {
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
			}

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

	// Native /v1/messages web search: the request direction maps Anthropic's
	// web_search_20250305 server tool onto the internal web_search tool, and the
	// response direction must reconstruct server_tool_use +
	// web_search_tool_result blocks from the inner response's url_citation
	// annotations. Before that mapping, native Anthropic SDK clients received
	// text-only content and an empty sources list.
	test(
		"native /v1/messages web search returns web_search_tool_result blocks",
		{ timeout: 300000 },
		async () => {
			const requestId = generateTestRequestId();
			const res = await app.request("/v1/messages", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"x-request-id": requestId,
					"x-no-fallback": "true",
					Authorization: `Bearer real-token`,
				},
				body: JSON.stringify({
					model: "anthropic/claude-haiku-4-5",
					max_tokens: 400,
					tools: [
						{
							type: "web_search_20250305",
							name: "web_search",
							max_uses: 2,
						},
					],
					messages: [
						{
							role: "user",
							content:
								"Search the web for the latest news about artificial intelligence from today. What are the top stories?",
						},
					],
				}),
			});

			const json = await res.json();
			if (logMode) {
				console.log(
					"native messages web search response:",
					JSON.stringify(json, null, 2),
				);
			}

			expect(res.status).toBe(200);
			expect(Array.isArray(json.content)).toBe(true);

			const blockTypes: string[] = json.content.map(
				(b: { type: string }) => b.type,
			);
			expect(blockTypes).toContain("server_tool_use");
			expect(blockTypes).toContain("web_search_tool_result");
			expect(blockTypes).toContain("text");

			// Anthropic's block order: server_tool_use precedes its
			// web_search_tool_result, and the text citing the results follows them.
			const serverToolUseIndex = blockTypes.indexOf("server_tool_use");
			const toolResultIndex = blockTypes.indexOf("web_search_tool_result");
			expect(serverToolUseIndex).toBeLessThan(toolResultIndex);
			expect(blockTypes.lastIndexOf("text")).toBeGreaterThan(toolResultIndex);

			const serverToolUse = json.content.find(
				(b: { type: string }) => b.type === "server_tool_use",
			);
			expect(serverToolUse.name).toBe("web_search");
			expect(typeof serverToolUse.id).toBe("string");
			expect(serverToolUse.id.length).toBeGreaterThan(0);

			const toolResult = json.content.find(
				(b: { type: string }) => b.type === "web_search_tool_result",
			);
			expect(toolResult.tool_use_id).toBe(serverToolUse.id);
			expect(Array.isArray(toolResult.content)).toBe(true);
			expect(toolResult.content.length).toBeGreaterThan(0);
			const firstResult = toolResult.content[0];
			expect(firstResult.type).toBe("web_search_result");
			expect(firstResult.url).toMatch(/^https?:\/\//);
			expect(typeof firstResult.title).toBe("string");

			// Web search cost must be tracked on the log like the OpenAI lane.
			const log = await validateLogByRequestId(requestId);
			expect(typeof log.webSearchCost).toBe("number");
			expect(log.webSearchCost).toBeGreaterThan(0);
		},
	);

	test(
		"native /v1/messages streaming web search emits web_search_tool_result blocks",
		{ timeout: 300000 },
		async () => {
			const requestId = generateTestRequestId();
			const res = await app.request("/v1/messages", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"x-request-id": requestId,
					"x-no-fallback": "true",
					Authorization: `Bearer real-token`,
				},
				body: JSON.stringify({
					model: "anthropic/claude-haiku-4-5",
					max_tokens: 400,
					stream: true,
					tools: [
						{
							type: "web_search_20250305",
							name: "web_search",
							max_uses: 2,
						},
					],
					messages: [
						{
							role: "user",
							content:
								"Search the web for the latest news about artificial intelligence from today. What are the top stories?",
						},
					],
				}),
			});

			expect(res.status).toBe(200);
			expect(res.headers.get("content-type")).toContain("text/event-stream");

			const streamResult = await readAll(res.body);
			if (logMode) {
				console.log(
					"native messages streaming web search chunks:",
					JSON.stringify(streamResult.chunks, null, 2),
				);
			}

			interface AnthropicStreamChunk {
				type?: string;
				index?: number;
				content_block?: {
					type?: string;
					tool_use_id?: string;
					content?: Array<{ type?: string; url?: string; title?: string }>;
				};
				usage?: { input_tokens?: number; output_tokens?: number };
			}
			const chunks = streamResult.chunks as AnthropicStreamChunk[];

			const starts = chunks.filter(
				(chunk) => chunk.type === "content_block_start",
			);
			const startTypes = starts.map((chunk) => chunk.content_block?.type);
			expect(startTypes).toContain("server_tool_use");
			expect(startTypes).toContain("web_search_tool_result");
			expect(startTypes).toContain("text");

			// Anthropic's block order: server_tool_use starts before its
			// web_search_tool_result, and the text block citing the results starts
			// after them (a preamble text block before the search may exist, so
			// compare against the last text block).
			const serverToolUseStart = starts.find(
				(chunk) => chunk.content_block?.type === "server_tool_use",
			);
			const toolResultStart = starts.find(
				(chunk) => chunk.content_block?.type === "web_search_tool_result",
			);
			const lastTextStart = [...starts]
				.reverse()
				.find((chunk) => chunk.content_block?.type === "text");
			expect(serverToolUseStart!.index!).toBeLessThan(toolResultStart!.index!);
			expect(lastTextStart!.index!).toBeGreaterThan(toolResultStart!.index!);

			const toolResultContent = toolResultStart!.content_block!.content!;
			expect(Array.isArray(toolResultContent)).toBe(true);
			expect(toolResultContent.length).toBeGreaterThan(0);
			expect(toolResultContent[0].type).toBe("web_search_result");
			expect(toolResultContent[0].url).toMatch(/^https?:\/\//);

			// Every started block must be stopped exactly once.
			const stopIndexes = chunks
				.filter((chunk) => chunk.type === "content_block_stop")
				.map((chunk) => chunk.index);
			for (const start of starts) {
				expect(
					stopIndexes.filter((index) => index === start.index).length,
				).toBe(1);
			}

			// The final message_delta must still carry usage.
			const messageDelta = chunks.find(
				(chunk) => chunk.type === "message_delta",
			);
			expect(messageDelta!.usage!.input_tokens).toBeGreaterThan(0);
			expect(messageDelta!.usage!.output_tokens).toBeGreaterThan(0);
		},
	);

	// Native SDK clients append the assistant turn verbatim, so the
	// server_tool_use / web_search_tool_result blocks the previous test asserts
	// come straight back on the next request. They must be accepted (and
	// dropped) rather than rejected as an unknown content block.
	test(
		"native /v1/messages accepts its own web-search blocks on the next turn",
		{ timeout: 300000 },
		async () => {
			const search = await app.request("/v1/messages", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"x-request-id": generateTestRequestId(),
					"x-no-fallback": "true",
					Authorization: `Bearer real-token`,
				},
				body: JSON.stringify({
					model: "anthropic/claude-haiku-4-5",
					max_tokens: 400,
					tools: [{ type: "web_search_20250305", name: "web_search" }],
					messages: [
						{
							role: "user",
							content:
								"What is the latest published version of the ai npm package?",
						},
					],
				}),
			});

			expect(search.status).toBe(200);
			const searchJson = await search.json();
			const blockTypes: string[] = searchJson.content.map(
				(block: { type: string }) => block.type,
			);
			expect(blockTypes).toContain("web_search_tool_result");

			const requestId = generateTestRequestId();
			const followUp = await app.request("/v1/messages", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"x-request-id": requestId,
					"x-no-fallback": "true",
					Authorization: `Bearer real-token`,
				},
				body: JSON.stringify({
					model: "anthropic/claude-haiku-4-5",
					max_tokens: 400,
					tools: [{ type: "web_search_20250305", name: "web_search" }],
					messages: [
						{
							role: "user",
							content:
								"What is the latest published version of the ai npm package?",
						},
						// Replayed verbatim, exactly as an Anthropic SDK client would.
						{ role: "assistant", content: searchJson.content },
						{ role: "user", content: "Thanks! Say OK." },
					],
				}),
			});

			const followUpJson = await followUp.json();
			if (logMode) {
				console.log(
					"native messages web search follow-up:",
					JSON.stringify(followUpJson, null, 2),
				);
			}

			expect(followUp.status).toBe(200);
			expect(
				followUpJson.content.some(
					(block: { type: string }) => block.type === "text",
				),
			).toBe(true);
			await validateLogByRequestId(requestId);
		},
	);
});
