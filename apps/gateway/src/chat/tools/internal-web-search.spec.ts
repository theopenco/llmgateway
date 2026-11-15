import { afterEach, describe, expect, test, vi } from "vitest";

import {
	addInternalWebSearchCost,
	buildWebSearchQuery,
	injectWebSearchResults,
	internalWebSearchSkipReason,
	runInternalWebSearch,
	webSearchAnnotations,
	type InternalWebSearch,
} from "./internal-web-search.js";

const search: InternalWebSearch = {
	backend: "exa",
	query: "q",
	results: [
		{
			url: "https://example.com/a",
			title: "A",
			publishedDate: "2026-11-01T00:00:00.000Z",
			highlights: ["alpha"],
		},
	],
	backendCostUsd: 0.007,
};

describe("buildWebSearchQuery", () => {
	test("uses the latest user message", () => {
		expect(
			buildWebSearchQuery([
				{ role: "system", content: "sys" },
				{
					role: "user",
					content: [
						{ type: "text", text: "latest  node" },
						{ type: "text", text: "release" },
					],
				},
			]),
		).toBe("latest node release");
	});

	test("skips turns that do not end with a user message", () => {
		expect(
			buildWebSearchQuery([
				{ role: "user", content: "hi" },
				{ role: "tool", content: "result", tool_call_id: "c1" },
			]),
		).toBeNull();
	});

	test("keeps the tail of a long message", () => {
		const query = buildWebSearchQuery([
			{ role: "user", content: `${"x".repeat(2000)} question?` },
		]);
		expect(query).toHaveLength(1000);
		expect(query?.endsWith("question?")).toBe(true);
	});
});

describe("injectWebSearchResults", () => {
	test("appends results to a string message without mutating input", () => {
		const messages = [{ role: "user" as const, content: "q" }];
		const out = injectWebSearchResults(messages, search);
		expect(messages[0].content).toBe("q");
		expect(out[0].content).toContain("q\n\n<web_search_results");
		expect(out[0].content).toContain("URL: https://example.com/a");
	});

	test("appends a text part to an array message", () => {
		const out = injectWebSearchResults(
			[{ role: "user", content: [{ type: "text", text: "q" }] }],
			search,
		);
		expect(out[0].content).toHaveLength(2);
	});

	test("leaves messages alone when nothing was found", () => {
		const messages = [{ role: "user" as const, content: "q" }];
		expect(injectWebSearchResults(messages, { ...search, results: [] })).toBe(
			messages,
		);
	});
});

test("internalWebSearchSkipReason", () => {
	expect(internalWebSearchSkipReason("none", false)).toBe("tool_choice_none");
	expect(internalWebSearchSkipReason("auto", true)).toBe("compliance_policy");
	expect(internalWebSearchSkipReason({ type: "web_search" }, false)).toBeNull();
	expect(internalWebSearchSkipReason(undefined, false)).toBeNull();
});

test("webSearchAnnotations maps results to url_citation", () => {
	expect(webSearchAnnotations(search)).toEqual([
		{
			type: "url_citation",
			url_citation: {
				url: "https://example.com/a",
				title: "A",
				date: "2026-11-01",
			},
		},
	]);
});

test("addInternalWebSearchCost adds to web search and total cost", () => {
	const costs = { webSearchCost: 0, totalCost: 0.0001 };
	addInternalWebSearchCost(costs, "0.007");
	expect(costs).toEqual({ webSearchCost: 0.007, totalCost: 0.0071 });
});

describe("runInternalWebSearch", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.unstubAllEnvs();
	});

	test("maps the tool options onto the Exa request", async () => {
		vi.stubEnv("EXA_AI_API_KEY", "k");
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					results: [
						{ url: "https://example.com/a", title: "A", highlights: ["h"] },
						{ url: "javascript:alert(1)", title: "bad" },
					],
					costDollars: { total: 0.007 },
				}),
			),
		);
		vi.stubGlobal("fetch", fetchMock);

		const result = await runInternalWebSearch(
			"exa",
			"q",
			{
				type: "web_search",
				search_context_size: "high",
				allowed_domains: ["example.com"],
				user_location: { type: "approximate", country: "de" },
			},
			"req",
		);

		const body = JSON.parse(fetchMock.mock.calls[0][1].body);
		expect(body).toMatchObject({
			query: "q",
			numResults: 10,
			includeDomains: ["example.com"],
			userLocation: "DE",
		});
		expect(result?.results.map((r) => r.url)).toEqual([
			"https://example.com/a",
		]);
		expect(result?.backendCostUsd).toBe(0.007);
	});

	test("retries a network error once, then gives up", async () => {
		vi.stubEnv("EXA_AI_API_KEY", "k");
		const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
		vi.stubGlobal("fetch", fetchMock);

		await expect(
			runInternalWebSearch("exa", "q", { type: "web_search" }, "req"),
		).resolves.toBeNull();
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	test("returns null without an API key", async () => {
		vi.stubEnv("EXA_AI_API_KEY", "");
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);

		await expect(
			runInternalWebSearch("exa", "q", { type: "web_search" }, "req"),
		).resolves.toBeNull();
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
