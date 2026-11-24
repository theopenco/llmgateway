import { afterEach, describe, expect, test, vi } from "vitest";

import {
	buildPlannerConversation,
	parsePlan,
	planWebSearch,
} from "./web-search-planner.js";

const credential = vi.hoisted(() => ({
	has: vi.fn(async () => true),
	resolve: vi.fn(async (_provider: string, path: string) => ({
		id: "env:0",
		providerToken: "gk",
		url: `https://generativelanguage.googleapis.com${path}`,
	})),
}));

vi.mock("./content-filter-credential.js", () => ({
	hasContentFilterCredential: credential.has,
	resolveContentFilterCredential: credential.resolve,
}));

function geminiAnswer(text: string): Response {
	return new Response(
		JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }),
	);
}

describe("buildPlannerConversation", () => {
	test("keeps the latest turns, drops system prompts and caps long turns", () => {
		const out = buildPlannerConversation([
			{ role: "system", content: "Use the web_search tool. Reply in JSON." },
			{ role: "user", content: "Who won the last F1 race?" },
			{ role: "assistant", content: "Max Verstappen." },
			{
				role: "user",
				content: [{ type: "text", text: `${"x".repeat(5000)} and second?` }],
			},
		]);
		expect(out).not.toContain("web_search");
		expect(out.split("\n")).toHaveLength(3);
		expect(out).toMatch(/^\[user\] Who won/);
		expect(out).toMatch(/\[user\] …x+ and second\?$/);
		expect(out.length).toBeLessThan(2_200);
	});

	test("skips turns without text, such as tool calls with null content", () => {
		const out = buildPlannerConversation([
			{ role: "user", content: "Weather in Paris?" },
			{
				role: "assistant",
				content: null as unknown as string,
				tool_calls: [
					{
						id: "c",
						type: "function",
						function: { name: "get_weather", arguments: "{}" },
					},
				],
			},
			{ role: "tool", tool_call_id: "c", content: "Sunny" },
		]);
		expect(out).toBe("[user] Weather in Paris?\n[tool] Sunny");
	});
});

describe("parsePlan", () => {
	test("cleans and caps the queries", () => {
		expect(
			parsePlan(
				JSON.stringify({
					search: true,
					queries: [" a  b ", "a b", "c", "d", "e", 1],
				}),
				false,
			),
		).toEqual({ search: true, queries: ["a b", "c", "d"] });
	});

	test("an offered search can be declined, a forced one cannot", () => {
		const declined = JSON.stringify({ search: false, queries: [] });
		expect(parsePlan(declined, false)).toEqual({ search: false, queries: [] });
		expect(parsePlan(declined, true)).toBeNull();
		expect(
			parsePlan(JSON.stringify({ search: false, queries: ["q"] }), true),
		).toEqual({ search: true, queries: ["q"] });
	});

	test("rejects malformed answers", () => {
		expect(parsePlan("not json", false)).toBeNull();
		expect(
			parsePlan(JSON.stringify({ search: true, queries: [] }), false),
		).toBeNull();
		expect(parsePlan("null", false)).toBeNull();
	});
});

describe("planWebSearch", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	test("asks the planner model with the conversation and returns its plan", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValue(
				geminiAnswer(
					JSON.stringify({ search: true, queries: ["latest Node.js release"] }),
				),
			);
		vi.stubGlobal("fetch", fetchMock);

		const plan = await planWebSearch(
			[{ role: "user", content: "Use web search. Latest Node.js release?" }],
			false,
			"req",
		);

		expect(plan).toEqual({ search: true, queries: ["latest Node.js release"] });
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe(
			"https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent",
		);
		expect(init.headers["x-goog-api-key"]).toBe("gk");
		const body = JSON.parse(init.body);
		expect(body.contents[0].parts[0].text).toContain(
			"[user] Use web search. Latest Node.js release?",
		);
		expect(body.generationConfig.responseMimeType).toBe("application/json");
	});

	test("fails open without a credential, on errors and on timeouts", async () => {
		const messages = [{ role: "user" as const, content: "q" }];
		credential.has.mockResolvedValueOnce(false);
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		expect(await planWebSearch(messages, true, "req")).toBeNull();
		expect(fetchMock).not.toHaveBeenCalled();

		fetchMock.mockResolvedValueOnce(new Response("boom", { status: 500 }));
		expect(await planWebSearch(messages, true, "req")).toBeNull();

		fetchMock
			.mockRejectedValueOnce(new TypeError("fetch failed"))
			.mockRejectedValueOnce(new TypeError("fetch failed"));
		expect(await planWebSearch(messages, true, "req")).toBeNull();
	});

	test("retries a network error once", async () => {
		const fetchMock = vi
			.fn()
			.mockRejectedValueOnce(new TypeError("fetch failed"))
			.mockResolvedValueOnce(
				geminiAnswer(JSON.stringify({ search: true, queries: ["q"] })),
			);
		vi.stubGlobal("fetch", fetchMock);
		expect(
			await planWebSearch([{ role: "user", content: "q" }], false, "req"),
		).toEqual({ search: true, queries: ["q"] });
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	test("skips an empty conversation", async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		expect(
			await planWebSearch([{ role: "system", content: "s" }], false, "req"),
		).toBeNull();
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
