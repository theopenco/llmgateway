import { describe, expect, test } from "vitest";

import {
	applyWebSearchFormat,
	billedServerToolUseCount,
	promptTokensShowSearchContext,
	reportedWebSearchCount,
} from "./web-search-format.js";

describe("applyWebSearchFormat", () => {
	const location = { type: "approximate" as const, country: "US", city: "NYC" };

	test("web_search_options carries context size and nested location", () => {
		const body: Record<string, any> = {};
		applyWebSearchFormat(
			body,
			{
				type: "web_search",
				search_context_size: "low",
				user_location: location,
				forced: true,
			},
			"web_search_options",
			true,
		);
		expect(body).toEqual({
			web_search_options: {
				search_context_size: "low",
				user_location: {
					type: "approximate",
					approximate: {
						city: "NYC",
						region: undefined,
						country: "US",
						timezone: undefined,
					},
				},
			},
		});
	});

	test("tool shape offers the tool and leaves tool_choice to the model", () => {
		const fn = { type: "function", function: { name: "f" } };
		const body: Record<string, any> = { tools: [fn] };
		applyWebSearchFormat(
			body,
			{ type: "web_search", user_location: location },
			"web_search_tool",
			true,
		);
		expect(body.tools).toEqual([
			fn,
			{ type: "web_search", user_location: location },
		]);
		expect(body.tool_choice).toBeUndefined();
	});

	test("tool shape forces with required, when the mapping takes it", () => {
		const forced = { type: "web_search" as const, forced: true };
		const body: Record<string, any> = {};
		applyWebSearchFormat(body, forced, "web_search_tool", true);
		expect(body.tool_choice).toBe("required");

		const restricted: Record<string, any> = {};
		applyWebSearchFormat(restricted, forced, "web_search_tool", false);
		expect(restricted.tool_choice).toBeUndefined();
	});

	test("a forced search next to function tools leaves tool_choice unset", () => {
		// "required" could be met by calling the caller's function instead.
		const fn = { type: "function", function: { name: "get_weather" } };
		const body: Record<string, any> = { tools: [fn] };
		applyWebSearchFormat(
			body,
			{ type: "web_search", forced: true },
			"web_search_tool",
			true,
		);
		expect(body.tools).toEqual([fn, { type: "web_search" }]);
		expect(body.tool_choice).toBeUndefined();
	});
});

describe("reportedWebSearchCount", () => {
	test("url_citation annotations count one search", () => {
		const citation = { type: "url_citation", url_citation: { url: "u" } };
		expect(
			reportedWebSearchCount({
				choices: [{ message: { annotations: [citation, citation] } }],
			}),
		).toBe(1);
		expect(
			reportedWebSearchCount({
				choices: [{ delta: { annotations: [citation] } }],
			}),
		).toBe(1);
	});

	test("usage counters count what they say", () => {
		expect(
			reportedWebSearchCount({
				usage: { server_tool_use: { web_search_requests: 3 } },
			}),
		).toBe(3);
		expect(reportedWebSearchCount({ usage: { num_search_queries: 2 } })).toBe(
			2,
		);
	});

	test("a plain completion counts none", () => {
		expect(
			reportedWebSearchCount({
				choices: [{ message: { content: "4", annotations: [] } }],
				usage: { prompt_tokens: 559 },
			}),
		).toBe(0);
	});
});

describe("billedServerToolUseCount", () => {
	test("sums successful searches and page fetches", () => {
		expect(
			billedServerToolUseCount({
				input_tokens: 72239,
				server_tool_use: { tool_search: 4, tool_fetch: 4 },
			}),
		).toBe(8);
		// DeepSeek's Anthropic API also reports attempted searches; only
		// `tool_search` is billed.
		expect(
			billedServerToolUseCount({
				server_tool_use: { web_search_requests: 4, tool_search: 3 },
			}),
		).toBe(3);
	});

	test("undefined without DeepSeek's counters", () => {
		expect(billedServerToolUseCount({ input_tokens: 22 })).toBeUndefined();
		expect(billedServerToolUseCount(null)).toBeUndefined();
		// Anthropic's own usage is left to the caller's block count.
		expect(
			billedServerToolUseCount({
				server_tool_use: { web_search_requests: 2 },
			}),
		).toBeUndefined();
	});

	test("zero without the counters when the upstream always reports them", () => {
		expect(billedServerToolUseCount({ input_tokens: 22 }, true)).toBe(0);
		expect(billedServerToolUseCount(undefined, true)).toBeUndefined();
	});
});

describe("promptTokensShowSearchContext", () => {
	const body = {
		model: "qwen3.8-max",
		messages: [{ role: "user", content: "What is 2+2?" }],
		tools: [{ type: "web_search" }],
	};

	test("a prompt far beyond the request's bytes is injected context", () => {
		// Measured on SCX: ~15k-150k prompt tokens when it searched.
		expect(promptTokensShowSearchContext(15_798, body)).toBe(true);
	});

	test("the tool template alone is not", () => {
		// Measured on SCX: 559 prompt tokens for an offered, unused tool.
		expect(promptTokensShowSearchContext(559, body)).toBe(false);
		expect(promptTokensShowSearchContext(null, body)).toBe(false);
	});

	test("a CJK prompt cannot exceed its own byte length", () => {
		const content = "天气".repeat(5_000);
		expect(
			promptTokensShowSearchContext(10_000, {
				messages: [{ role: "user", content }],
			}),
		).toBe(false);
	});

	test("a multipart body is undecidable", () => {
		expect(promptTokensShowSearchContext(50_000, new FormData())).toBe(false);
	});

	test("media makes the bound undecidable", () => {
		expect(
			promptTokensShowSearchContext(50_000, {
				messages: [
					{
						role: "user",
						content: [
							{ type: "image_url", image_url: { url: "https://x/y.png" } },
						],
					},
				],
			}),
		).toBe(false);
	});
});
