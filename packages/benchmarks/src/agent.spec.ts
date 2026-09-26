import { describe, expect, it } from "vitest";

import { executeAgentRequest } from "./agent.js";

import type {
	BenchmarkAgentSession,
	BenchmarkRunContext,
	BenchmarkTarget,
} from "./types.js";

const target: BenchmarkTarget = { id: "t", model: "m" };

const context: BenchmarkRunContext = {
	caseId: "c",
	run: 1,
	seed: 1,
	target,
	warmup: false,
};

function sse(chunks: Record<string, unknown>[]): Response {
	const body = chunks
		.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
		.join("");
	return new Response(`${body}data: [DONE]\n\n`, {
		headers: { "content-type": "text/event-stream" },
		status: 200,
	});
}

function toolCallChunk(name: string, args: string): Record<string, unknown> {
	return {
		choices: [
			{
				delta: {
					tool_calls: [
						{ index: 0, id: "call_1", function: { name, arguments: args } },
					],
				},
				finish_reason: "tool_calls",
			},
		],
		usage: { prompt_tokens: 10, completion_tokens: 5 },
	};
}

function textChunk(content: string): Record<string, unknown> {
	return {
		choices: [{ delta: { content }, finish_reason: "stop" }],
		usage: { prompt_tokens: 20, completion_tokens: 7 },
	};
}

function session(calls: string[]): BenchmarkAgentSession {
	return {
		tools: [
			{
				type: "function",
				function: { name: "ping", parameters: { type: "object" } },
			},
		],
		callTool: (call) => {
			calls.push(call.function.name);
			return call.function.name === "ping"
				? { content: "pong" }
				: { content: "unknown tool", isError: true };
		},
		evaluate: (response) => ({
			passed: response.content.includes("DONE"),
			answer: response.content,
		}),
	};
}

describe("executeAgentRequest", () => {
	it("feeds tool results back and stops when the model answers", async () => {
		const calls: string[] = [];
		const responses = [
			sse([toolCallChunk("ping", "{}")]),
			sse([textChunk("DONE")]),
		];
		const bodies: string[] = [];
		const outcome = await executeAgentRequest({
			client: { url: "https://example.com/v1/chat/completions" },
			request: { messages: [{ role: "user", content: "go" }] },
			model: "m",
			timeoutMs: 1000,
			fetch: (async (_url: string, init: RequestInit) => {
				bodies.push(String(init.body));
				return responses.shift();
			}) as unknown as typeof fetch,
			agent: { maxTurns: 5, createSession: () => session(calls) },
			context,
		});

		expect(calls).toEqual(["ping"]);
		expect(outcome.response.agent?.turnCount).toBe(2);
		expect(outcome.response.agent?.toolCallCount).toBe(1);
		expect(outcome.response.agent?.stopReason).toBe("no_tool_calls");
		expect(outcome.evaluation?.passed).toBe(true);

		const second = JSON.parse(bodies[1]) as {
			messages: { role: string; content: string }[];
		};
		expect(second.messages.map((message) => message.role)).toEqual([
			"user",
			"assistant",
			"tool",
		]);
		expect(second.messages[2].content).toBe("pong");
	});

	it("sums usage across turns", async () => {
		const responses = [
			sse([toolCallChunk("ping", "{}")]),
			sse([textChunk("DONE")]),
		];
		const outcome = await executeAgentRequest({
			client: { url: "https://example.com/v1/chat/completions" },
			request: { messages: [{ role: "user", content: "go" }] },
			model: "m",
			timeoutMs: 1000,
			fetch: (async () => responses.shift()) as unknown as typeof fetch,
			agent: { maxTurns: 5, createSession: () => session([]) },
			context,
		});

		expect(outcome.response.usage.promptTokens).toBe(30);
		expect(outcome.response.usage.completionTokens).toBe(12);
	});

	it("stops at maxTurns when the model never stops calling tools", async () => {
		const outcome = await executeAgentRequest({
			client: { url: "https://example.com/v1/chat/completions" },
			request: { messages: [{ role: "user", content: "go" }] },
			model: "m",
			timeoutMs: 1000,
			fetch: (async () =>
				sse([toolCallChunk("ping", "{}")])) as unknown as typeof fetch,
			agent: { maxTurns: 3, createSession: () => session([]) },
			context,
		});

		expect(outcome.response.agent?.turnCount).toBe(3);
		expect(outcome.response.agent?.stopReason).toBe("max_turns");
		expect(outcome.response.agent?.repeatedToolCallCount).toBe(2);
	});

	it("counts tool errors and skips evaluation on an upstream failure", async () => {
		const responses = [
			sse([toolCallChunk("nope", "{}")]),
			new Response("boom", { status: 500 }),
		];
		const outcome = await executeAgentRequest({
			client: { url: "https://example.com/v1/chat/completions" },
			request: { messages: [{ role: "user", content: "go" }] },
			model: "m",
			timeoutMs: 1000,
			fetch: (async () => responses.shift()) as unknown as typeof fetch,
			agent: { maxTurns: 5, createSession: () => session([]) },
			context,
		});

		expect(outcome.response.agent?.invalidToolCallCount).toBe(1);
		expect(outcome.response.agent?.stopReason).toBe("error");
		expect(outcome.evaluation).toBeNull();
	});
});
