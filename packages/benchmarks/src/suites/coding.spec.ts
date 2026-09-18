import { describe, expect, it } from "vitest";

import { codingCases } from "./coding.js";

import type {
	BenchmarkAgentSession,
	BenchmarkCase,
	BenchmarkResponse,
	BenchmarkRunContext,
} from "@/types.js";

const context: BenchmarkRunContext = {
	caseId: "agentic_bugfix_small",
	run: 1,
	seed: 1,
	target: { id: "t", model: "m" },
	warmup: false,
};

function openSession(benchmarkCase: BenchmarkCase): BenchmarkAgentSession {
	const agent = benchmarkCase.agent;
	if (!agent) {
		throw new Error(`${benchmarkCase.id} has no agent spec`);
	}
	return agent.createSession(context);
}

function call(
	session: BenchmarkAgentSession,
	name: string,
	args: Record<string, unknown> = {},
): string {
	return session.callTool({
		id: "call_1",
		type: "function",
		function: { name, arguments: JSON.stringify(args) },
	}).content;
}

function response(): BenchmarkResponse {
	return {
		content: "FINAL: DONE",
		reasoning: "",
		toolCalls: [],
		finishReason: "stop",
		responseModel: null,
		requestId: null,
		usage: {
			promptTokens: null,
			completionTokens: null,
			reasoningTokens: null,
			visibleCompletionTokens: null,
			raw: null,
		},
		timing: {
			headersMs: null,
			firstEventMs: null,
			firstReasoningMs: null,
			firstContentMs: null,
			lastContentMs: null,
			generationMs: null,
			totalMs: 1,
			visibleTokensPerSecond: null,
			contentChunkCount: 0,
			averageContentChunkCharacters: null,
			maxContentStallMs: null,
			finalContentBurstRatio: null,
			buffered: null,
		},
		streamChunks: [],
		error: null,
		agent: {
			turnCount: 3,
			toolCallCount: 4,
			invalidToolCallCount: 0,
			repeatedToolCallCount: 0,
			toolCallsByName: {},
			stopReason: "no_tool_calls",
			turns: [],
			invocations: [],
		},
	};
}

const bugfix = codingCases.find((item) => item.id === "agentic_bugfix_small");
const feature = codingCases.find((item) => item.id === "agentic_feature_small");

describe("coding suite", () => {
	it("exposes agentic cases with a tool loop", () => {
		for (const benchmarkCase of codingCases) {
			expect(benchmarkCase.kind).toBe("agentic");
			expect(benchmarkCase.agent?.maxTurns).toBeGreaterThan(1);
			expect(openSession(benchmarkCase).tools.length).toBeGreaterThan(0);
		}
	});

	it("starts the bug-fix repository with a failing suite", () => {
		const session = openSession(bugfix!);
		expect(call(session, "run_tests")).toContain("FAIL");
		expect(session.evaluate(response()).passed).toBe(false);
	});

	it("passes once the off-by-one in chunk is fixed", () => {
		const session = openSession(bugfix!);
		const original = call(session, "read_file", { path: "src/paginate.js" });
		expect(original).toContain("index + size - 1");
		call(session, "write_file", {
			path: "src/paginate.js",
			content: original.replace("index + size - 1", "index + size"),
		});
		expect(call(session, "run_tests")).toContain("5/5 passing");

		const evaluation = session.evaluate(response());
		expect(evaluation.passed).toBe(true);
		expect(evaluation.metrics?.selfVerified).toBe(1);
	});

	it("passes the feature case once subtractCents clamps at zero", () => {
		const session = openSession(feature!);
		const original = call(session, "read_file", { path: "src/money.js" });
		call(session, "write_file", {
			path: "src/money.js",
			content: original.replace(
				"module.exports = { addCents, formatCents };",
				"function subtractCents(left, right) {\n" +
					"\treturn Math.max(0, left - right);\n" +
					"}\n\n" +
					"module.exports = { addCents, formatCents, subtractCents };",
			),
		});
		expect(call(session, "run_tests")).toContain("4/4 passing");
		expect(session.evaluate(response()).passed).toBe(true);
	});

	it("reports tool misuse without throwing", () => {
		const session = openSession(bugfix!);
		expect(call(session, "read_file", { path: "nope.js" })).toContain("Error");
		expect(
			call(session, "write_file", { path: "new.js", content: "x" }),
		).toContain("Error");
		expect(call(session, "unknown_tool")).toContain("unknown tool");
		expect(
			session.callTool({
				id: "call_1",
				type: "function",
				function: { name: "read_file", arguments: "{not json" },
			}).isError,
		).toBe(true);
	});

	it("finds the buggy line through search", () => {
		const session = openSession(bugfix!);
		expect(call(session, "search", { query: "slice" })).toContain(
			"src/paginate.js",
		);
		expect(call(session, "list_files")).toContain("tests/paginate.test.js");
	});
});
