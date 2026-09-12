import { describe, expect, it } from "vitest";

import { renderHtml, renderMarkdown } from "./reporters.js";
import { runBenchmark } from "./runner.js";

import type { BenchmarkCase, BenchmarkTarget } from "./types.js";

function streamResponse(answer: string): Response {
	const chunks = [
		{
			model: "upstream-model",
			choices: [{ delta: { reasoning_content: "thinking" } }],
		},
		{
			choices: [{ delta: { content: `FINAL: ${answer}` } }],
		},
		{
			choices: [{ delta: {}, finish_reason: "stop" }],
			usage: {
				prompt_tokens: 10,
				completion_tokens: 5,
				completion_tokens_details: { reasoning_tokens: 2 },
			},
		},
	];
	return new Response(
		`${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`,
		{
			status: 200,
			headers: { "x-request-id": "request-id" },
		},
	);
}

describe("runBenchmark", () => {
	it("returns serializable trials, summaries, and answer agreement", async () => {
		const targets: BenchmarkTarget[] = [
			{ id: "reference/model", model: "reference/model" },
			{
				id: "candidate/model",
				model: "candidate/model",
				displayName: "<unsafe>",
			},
		];
		const benchmarkCase: BenchmarkCase = {
			id: "exact",
			name: "exact",
			kind: "quality",
			request: {
				messages: [{ role: "user", content: "answer" }],
			},
			evaluate: (response) => {
				const answer = response.content.replace("FINAL: ", "");
				return {
					passed: answer === "42",
					answer,
					expected: "42",
				};
			},
		};
		const requests: Array<{ body: Record<string, unknown>; headers: Headers }> =
			[];
		const fetchMock: typeof fetch = async (_, init) => {
			const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
			const headers = new Headers(init?.headers);
			requests.push({ body, headers });
			return streamResponse("42");
		};

		const result = await runBenchmark({
			client: { url: "https://example.com/v1/chat/completions", apiKey: "key" },
			targets,
			cases: [benchmarkCase],
			fetch: fetchMock,
		});

		expect(JSON.parse(JSON.stringify(result))).toEqual(result);
		expect(result.schemaVersion).toBe(2);
		expect(result.trials).toHaveLength(2);
		expect(result.config.timeoutMs).toBe(60_000);
		expect(result.config.budgetMs).toBe(60_000);
		expect(result.trials[0]).toMatchObject({ seed: expect.any(Number) });
		expect(result.trials[0].response.usage).toMatchObject({
			completionTokens: 5,
			reasoningTokens: 2,
			visibleCompletionTokens: 3,
		});
		expect(result.summary.targets[1]).toMatchObject({
			quality: { attempted: 1, passed: 1, score: 1 },
			referenceAgreement: { compared: 1, matching: 1, rate: 1 },
		});
		expect(result.summary.targets[0].referenceAgreement).toBeNull();
		expect(requests[0].body).toMatchObject({
			model: "reference/model",
			stream: true,
		});
		expect(requests[0].headers.get("authorization")).toBe("Bearer key");
		expect(requests[0].headers.get("x-no-cache")).toBe("true");
		expect(requests[0].headers.get("x-no-fallback")).toBe("true");
		expect(renderMarkdown(result)).toContain("| &lt;unsafe&gt;");
		expect(renderHtml(result)).toContain("&lt;unsafe&gt;");
		expect(renderHtml(result)).not.toContain("<unsafe>");
	});

	it("enforces per-target budgets between runs", async () => {
		const fetchMock: typeof fetch = async () => {
			await new Promise((resolve) => setTimeout(resolve, 5));
			return streamResponse("42");
		};
		const result = await runBenchmark({
			client: { url: "https://example.com" },
			targets: [{ id: "target", model: "target" }],
			cases: [
				{
					id: "budgeted",
					name: "budgeted",
					kind: "quality",
					defaultRuns: 3,
					request: { messages: [{ role: "user", content: "answer" }] },
					evaluate: () => ({ passed: true, answer: "42" }),
				},
			],
			budgetMs: 1,
			fetch: fetchMock,
		});

		expect(result.trials).toHaveLength(1);
	});

	it("runs repeated trials at the case concurrency", async () => {
		let active = 0;
		let maxActive = 0;
		const fetchMock: typeof fetch = async () => {
			active++;
			maxActive = Math.max(maxActive, active);
			await new Promise((resolve) => setTimeout(resolve, 5));
			active--;
			return streamResponse("42");
		};
		const result = await runBenchmark({
			client: { url: "https://example.com" },
			targets: [{ id: "target", model: "target" }],
			cases: [
				{
					id: "load",
					name: "load",
					kind: "performance",
					defaultRuns: 3,
					defaultConcurrency: 3,
					request: { messages: [{ role: "user", content: "answer" }] },
					parameters: () => ({ concurrency: 3 }),
				},
			],
			budgetMs: null,
			fetch: fetchMock,
		});

		expect(maxActive).toBe(3);
		expect(result.summary.load[0]).toMatchObject({
			points: [{ concurrency: 3, attempted: 3 }],
		});
	});

	it("finishes concurrent warmups before measured requests", async () => {
		let activeWarmups = 0;
		let measuredOverlappedWarmup = false;
		const fetchMock: typeof fetch = async (_, init) => {
			const body = JSON.parse(String(init?.body)) as {
				messages: Array<{ content: string }>;
			};
			const warmup = body.messages[0]?.content === "warmup";
			if (warmup) {
				activeWarmups++;
			} else if (activeWarmups > 0) {
				measuredOverlappedWarmup = true;
			}
			await new Promise((resolve) => setTimeout(resolve, 5));
			if (warmup) {
				activeWarmups--;
			}
			return streamResponse("42");
		};
		await runBenchmark({
			client: { url: "https://example.com" },
			targets: [{ id: "target", model: "target" }],
			cases: [
				{
					id: "warmup-order",
					name: "warmup order",
					kind: "performance",
					defaultRuns: 2,
					defaultWarmupRuns: 2,
					defaultConcurrency: 2,
					request: (context) => ({
						messages: [
							{
								role: "user",
								content: context.warmup ? "warmup" : "measured",
							},
						],
					}),
				},
			],
			budgetMs: null,
			fetch: fetchMock,
		});

		expect(measuredOverlappedWarmup).toBe(false);
	});

	it("records in-stream provider errors", async () => {
		const fetchMock: typeof fetch = async () =>
			new Response(
				'data: {"error":{"code":"upstream","message":"unavailable"}}\n\n',
			);
		const result = await runBenchmark({
			client: { url: "https://example.com" },
			targets: [{ id: "provider/model", model: "provider/model" }],
			cases: [
				{
					id: "case",
					name: "case",
					kind: "performance",
					request: { messages: [{ role: "user", content: "hi" }] },
				},
			],
			fetch: fetchMock,
		});

		expect(result.trials[0].response.error).toEqual({
			code: "upstream",
			message: "unavailable",
		});
		expect(result.summary.targets[0].succeeded).toBe(0);
	});

	it("rejects duplicate target and case ids", async () => {
		const benchmarkCase: BenchmarkCase = {
			id: "case",
			name: "case",
			kind: "quality",
			request: { messages: [{ role: "user", content: "hi" }] },
		};
		const client = { url: "https://example.com" };

		await expect(
			runBenchmark({
				client,
				targets: [
					{ id: "duplicate", model: "first/model" },
					{ id: "duplicate", model: "second/model" },
				],
				cases: [benchmarkCase],
			}),
		).rejects.toThrow("Benchmark target ids must be unique");
		await expect(
			runBenchmark({
				client,
				targets: [{ id: "target", model: "provider/model" }],
				cases: [benchmarkCase, benchmarkCase],
			}),
		).rejects.toThrow("Benchmark case ids must be unique");
	});
});
