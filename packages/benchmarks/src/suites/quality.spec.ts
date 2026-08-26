import { describe, expect, it } from "vitest";

import {
	extractFinalAnswer,
	normalizeAnswer,
	qualityCases,
} from "./quality.js";

import type { BenchmarkResponse } from "@/types.js";

function response(content: string): BenchmarkResponse {
	return {
		content,
		reasoning: "",
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
			generationMs: null,
			totalMs: 0,
			visibleTokensPerSecond: null,
		},
		error: null,
	};
}

describe("quality suite", () => {
	it("extracts and normalizes the last FINAL answer", () => {
		expect(extractFinalAnswer("FINAL: wrong\nwork\nFINAL: 3 / 11")).toBe(
			"3/11",
		);
		expect(normalizeAnswer(" `Hello World` ")).toBe("helloworld");
	});

	it("uses the independently computed constrained-string answer", () => {
		const benchmarkCase = qualityCases.find(
			(candidate) => candidate.id === "constrained_strings",
		);
		expect(benchmarkCase).toBeDefined();
		expect(
			benchmarkCase?.evaluate?.(response("FINAL: 229433"), {
				caseId: "constrained_strings",
				run: 1,
				target: { id: "target", model: "target" },
				warmup: false,
			}),
		).toMatchObject({ passed: true, expected: "229433" });
		expect(
			benchmarkCase?.evaluate?.(response("FINAL: 144144"), {
				caseId: "constrained_strings",
				run: 1,
				target: { id: "target", model: "target" },
				warmup: false,
			}),
		).toMatchObject({ passed: false, answer: "144144" });
	});
});
