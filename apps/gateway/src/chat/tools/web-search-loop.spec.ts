import { describe, expect, test, vi } from "vitest";

import {
	runWebSearchLoop,
	sumUsage,
	mergeReasoningDetail,
	takeWebSearchLoopRound,
	WEB_SEARCH_LOOP_HEADER,
	type WebSearchLoopOptions,
} from "./web-search-loop.js";

import type { InternalWebSearch } from "./internal-web-search.js";

vi.mock("@/app.js", () => ({ app: {} }));

const search = (query: string): InternalWebSearch => ({
	engine: "perplexity",
	queries: [query],
	results: [
		{
			url: `https://news.test/${encodeURIComponent(query)}`,
			highlights: ["h"],
		},
	],
	engineCostUsd: null,
});

function completion(message: Record<string, unknown>, finish = "stop") {
	return new Response(
		JSON.stringify({
			id: "chatcmpl-1",
			choices: [{ index: 0, message, finish_reason: finish }],
			usage: {
				prompt_tokens: 10,
				completion_tokens: 2,
				total_tokens: 12,
				cost: 0.1,
			},
		}),
		{ headers: { "content-type": "application/json" } },
	);
}

const searchCall = (id: string, query: string) => ({
	id,
	type: "function",
	function: { name: "web_search", arguments: JSON.stringify({ query }) },
});

function options(
	responses: Response[],
	overrides: Partial<WebSearchLoopOptions> = {},
) {
	const bodies: Array<Record<string, any>> = [];
	const headers: Array<Record<string, string>> = [];
	const rounds: Array<ReturnType<typeof takeWebSearchLoopRound>> = [];
	const dispatch = vi.fn(
		async (body: Record<string, any>, h: Record<string, string>) => {
			bodies.push(body);
			headers.push(h);
			// What the round's handler reads on arrival.
			rounds.push(takeWebSearchLoopRound(h[WEB_SEARCH_LOOP_HEADER]));
			return responses.shift()!;
		},
	);
	const opts: WebSearchLoopOptions = {
		body: {
			messages: [{ role: "user", content: "Who won the race?" }],
		},
		pin: { provider: "aws-bedrock", model: "claude-sonnet-5" },
		stream: false,
		forced: false,
		canForceFunction: true,
		engine: "perplexity",
		price: "0.005",
		requestId: "req",
		dispatch,
		search: vi.fn(async (q: string) => search(q)),
		streamResponse: () => new Response(),
		...overrides,
	};
	return { opts, bodies, headers, rounds, dispatch };
}

describe("runWebSearchLoop", () => {
	test("answers in one call when the model does not search", async () => {
		const { opts, bodies } = options([
			completion({ role: "assistant", content: "4" }),
		]);
		const res = await runWebSearchLoop(opts);
		const json = await res!.json();
		expect(json.choices[0].message.content).toBe("4");
		expect(json.choices[0].message.annotations).toBeUndefined();
		expect(bodies).toHaveLength(1);
		expect(bodies[0].tools).toEqual([
			expect.objectContaining({
				function: expect.objectContaining({ name: "web_search" }),
			}),
		]);
		expect(opts.search).not.toHaveBeenCalled();
	});

	test("runs the model's searches, feeds results back and bills them on the next call", async () => {
		const { opts, bodies, headers, rounds } = options([
			completion(
				{
					role: "assistant",
					content: "",
					tool_calls: [
						searchCall("c1", "f1 winner"),
						searchCall("c2", "f1 podium"),
					],
					reasoning_details: [{ type: "reasoning.text", text: "t" }],
				},
				"tool_calls",
			),
			completion({ role: "assistant", content: "Verstappen" }),
		]);
		const res = await runWebSearchLoop(opts);
		const json = await res!.json();

		expect(opts.search).toHaveBeenCalledTimes(2);
		const history = bodies[1].messages.slice(1);
		expect(history[0]).toMatchObject({
			role: "assistant",
			tool_calls: [{ id: "c1" }, { id: "c2" }],
			reasoning_details: [{ type: "reasoning.text", text: "t" }],
		});
		expect(history[1]).toMatchObject({ role: "tool", tool_call_id: "c1" });
		expect(history[1].content).toContain("https://news.test/f1%20winner");

		expect(rounds[0]).toEqual({ followUp: false });
		expect(rounds[1]).toMatchObject({
			followUp: true,
			billing: { count: 2, price: "0.005" },
		});
		expect(bodies.map((b) => b.model)).toEqual([
			"aws-bedrock/claude-sonnet-5",
			"aws-bedrock/claude-sonnet-5",
		]);
		// Taken once, and dropped after the dispatch either way.
		expect(
			takeWebSearchLoopRound(headers[1][WEB_SEARCH_LOOP_HEADER]),
		).toBeUndefined();

		expect(json.choices[0].message.content).toBe("Verstappen");
		expect(json.choices[0].message.annotations).toHaveLength(2);
		expect(json.usage).toMatchObject({
			prompt_tokens: 20,
			total_tokens: 24,
			cost: 0.2,
		});
	});

	test("forces the first call to search when the caller requires it", async () => {
		const { opts, bodies } = options(
			[completion({ role: "assistant", content: "x" })],
			{ forced: true },
		);
		await runWebSearchLoop(opts);
		expect(bodies[0].tool_choice).toEqual({
			type: "function",
			function: { name: "web_search" },
		});
	});

	test("keeps the caller's tools and returns their calls without the search call", async () => {
		const userTool = {
			type: "function",
			function: { name: "save", parameters: { type: "object" } },
		};
		const { opts, bodies } = options(
			[
				completion(
					{
						role: "assistant",
						content: null,
						tool_calls: [
							searchCall("c1", "q"),
							{
								id: "c2",
								type: "function",
								function: { name: "save", arguments: "{}" },
							},
						],
					},
					"tool_calls",
				),
			],
			{ body: { messages: [], tools: [userTool] } },
		);
		const res = await runWebSearchLoop(opts);
		const json = await res!.json();
		expect(bodies[0].tools).toHaveLength(2);
		expect(json.choices[0].message.tool_calls).toEqual([
			expect.objectContaining({ id: "c2" }),
		]);
		expect(opts.search).not.toHaveBeenCalled();
	});

	test("stops offering search once max_uses is spent", async () => {
		const { opts, bodies } = options(
			[
				completion(
					{
						role: "assistant",
						content: "",
						tool_calls: [searchCall("c1", "q")],
					},
					"tool_calls",
				),
				completion({ role: "assistant", content: "done" }),
			],
			{ maxSearches: 1 },
		);
		await runWebSearchLoop(opts);
		expect(bodies[1].tools).toBeUndefined();
		expect(bodies[1].tool_choice).toBeUndefined();
	});

	test("falls back only when the first call fails upstream", async () => {
		expect(
			await runWebSearchLoop(
				options([new Response("{}", { status: 502 })]).opts,
			),
		).toBeNull();
		const rejected = await runWebSearchLoop(
			options([new Response('{"error":{}}', { status: 402 })]).opts,
		);
		expect(rejected?.status).toBe(402);
	});

	test("fails a required search when every search of it failed", async () => {
		const { opts, bodies } = options(
			[
				completion(
					{
						role: "assistant",
						content: "",
						tool_calls: [searchCall("c1", "q")],
					},
					"tool_calls",
				),
			],
			{ forced: true, search: vi.fn(async () => null) },
		);
		const res = await runWebSearchLoop(opts);
		expect(res?.status).toBe(503);
		expect(bodies).toHaveLength(1);
	});

	test("streams text live, hides search calls and moves sources ahead of the answer", async () => {
		const sse = (chunks: unknown[]) =>
			new Response(
				chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") +
					"data: [DONE]\n\n",
			);
		const delta = (
			d: unknown,
			finish: string | null = null,
			usage?: unknown,
		) => ({
			id: "c",
			model: "m",
			choices: [{ index: 0, delta: d, finish_reason: finish }],
			...(usage ? { usage } : {}),
		});
		const written: string[] = [];
		const { opts } = options(
			[
				sse([
					delta({ role: "assistant", content: "Let me check. " }),
					delta({
						tool_calls: [
							{
								index: 0,
								id: "c1",
								function: { name: "web_search", arguments: "" },
							},
						],
					}),
					delta({
						tool_calls: [
							{ index: 0, function: { arguments: '{"query":"q"}' } },
						],
					}),
					delta({}, "tool_calls", {
						prompt_tokens: 5,
						completion_tokens: 1,
						total_tokens: 6,
					}),
					// The costed usage chunk repeats the round's totals.
					{
						id: "c",
						model: "m",
						choices: [],
						usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 },
					},
				]),
				sse([
					delta({ content: "Answer." }),
					delta({}, "stop", {
						prompt_tokens: 7,
						completion_tokens: 2,
						total_tokens: 9,
					}),
				]),
			],
			{
				stream: true,
				streamResponse: async (pipe) => {
					await pipe(async (data) => {
						written.push(data);
					});
					return new Response();
				},
			},
		);
		await runWebSearchLoop(opts);
		const chunks = written
			.filter((d) => d !== "[DONE]")
			.map((d) => JSON.parse(d));
		const text = chunks
			.map((c) => c.choices?.[0]?.delta?.content ?? "")
			.join("");
		expect(text).toBe("Let me check. Answer.");
		expect(chunks.some((c) => c.choices?.[0]?.delta?.tool_calls)).toBe(false);
		const sourceIndex = chunks.findIndex(
			(c) => c.choices?.[0]?.delta?.annotations,
		);
		const answerIndex = chunks.findIndex(
			(c) => c.choices?.[0]?.delta?.content === "Answer.",
		);
		expect(sourceIndex).toBeGreaterThan(-1);
		expect(sourceIndex).toBeLessThan(answerIndex);
		const finishes = chunks.filter((c) => c.choices?.[0]?.finish_reason);
		expect(finishes.map((c) => c.choices[0].finish_reason)).toEqual(["stop"]);
		expect(finishes[0].usage).toEqual({
			prompt_tokens: 12,
			completion_tokens: 3,
			total_tokens: 15,
		});
		expect(written.at(-1)).toBe("[DONE]");
	});
});

describe("mergeReasoningDetail", () => {
	test("joins streamed pieces of one entry and keeps distinct entries", () => {
		const details: Array<Record<string, unknown>> = [];
		mergeReasoningDetail(details, {
			type: "reasoning.text",
			index: 0,
			text: "a",
		});
		mergeReasoningDetail(details, {
			type: "reasoning.text",
			index: 0,
			text: "b",
			signature: "sig",
		});
		mergeReasoningDetail(details, { type: "reasoning.encrypted", data: "x" });
		expect(details).toEqual([
			{ type: "reasoning.text", index: 0, text: "ab", signature: "sig" },
			{ type: "reasoning.encrypted", data: "x" },
		]);
	});
});

describe("sumUsage", () => {
	test("adds nested numbers and keeps other fields", () => {
		expect(
			sumUsage({ a: 1, b: { c: 0.1 }, d: "x" }, { a: 2, b: { c: 0.2, e: 1 } }),
		).toEqual({ a: 3, b: { c: 0.3, e: 1 }, d: "x" });
	});
});
