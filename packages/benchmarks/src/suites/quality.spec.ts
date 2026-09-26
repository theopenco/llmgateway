import { describe, expect, it } from "vitest";

import { capabilityCases } from "./capability.js";
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
			totalMs: 0,
			visibleTokensPerSecond: null,
			contentChunkCount: 0,
			averageContentChunkCharacters: null,
			maxContentStallMs: null,
			finalContentBurstRatio: null,
			buffered: null,
		},
		streamChunks: [],
		error: null,
		agent: null,
	};
}

describe("quality suite", () => {
	it.each(["", "|", "|no", "|-1", "|2"])(
		"rejects missing or invalid calibration confidence %s",
		async (suffix) => {
			const benchmarkCase = capabilityCases.find(
				(item) => item.id === "calibrated_probability",
			)!;
			expect(
				(
					await benchmarkCase.evaluate!(response(`FINAL: 1/6${suffix}`), {
						caseId: benchmarkCase.id,
						run: 1,
						seed: 1,
						target: { id: "t", model: "t" },
						warmup: false,
					})
				).passed,
			).toBe(false);
		},
	);
	it("requires the cipher answer to preserve uppercase", async () => {
		const benchmarkCase = qualityCases.find(
			(item) => item.id === "instruction_cipher",
		)!;
		const context = {
			caseId: benchmarkCase.id,
			run: 1,
			seed: 1,
			target: { id: "t", model: "t" },
			warmup: false,
		};
		expect(
			(await benchmarkCase.evaluate!(response("FINAL: TZGLQDOMYZWQ"), context))
				.passed,
		).toBe(true);
		expect(
			(await benchmarkCase.evaluate!(response("FINAL: tzglqdomyzwq"), context))
				.passed,
		).toBe(false);
	});
	it("extracts and normalizes the last FINAL answer", () => {
		expect(extractFinalAnswer("FINAL: wrong\nwork\nFINAL: 3 / 11")).toBe(
			"3/11",
		);
		expect(normalizeAnswer(" `Hello World` ")).toBe("helloworld");
	});

	it("normalizes long runs of wrapping quotes", () => {
		const quotes = "'\"`".repeat(100_000);
		expect(normalizeAnswer(`${quotes} Value ${quotes}`)).toBe("value");
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
				seed: 1,
				target: { id: "target", model: "target" },
				warmup: false,
			}),
		).toMatchObject({ passed: true, expected: "229433" });
		expect(
			benchmarkCase?.evaluate?.(response("FINAL: 144144"), {
				caseId: "constrained_strings",
				run: 1,
				seed: 1,
				target: { id: "target", model: "target" },
				warmup: false,
			}),
		).toMatchObject({ passed: false, answer: "144144" });
	});
});
