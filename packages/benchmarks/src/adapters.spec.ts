import { describe, expect, it } from "vitest";

import { createSandboxedCodingCase, loadExternalSuite } from "./adapters.js";

describe("benchmark adapters", () => {
	it("loads external cases and rejects duplicate ids", async () => {
		const benchmarkCase = {
			id: "external",
			name: "external",
			kind: "quality" as const,
			request: { messages: [{ role: "user" as const, content: "test" }] },
		};
		await expect(
			loadExternalSuite(
				{ id: "ok", name: "ok", load: () => [benchmarkCase] },
				{},
			),
		).resolves.toEqual([benchmarkCase]);
		await expect(
			loadExternalSuite(
				{ id: "bad", name: "bad", load: () => [benchmarkCase, benchmarkCase] },
				{},
			),
		).rejects.toThrow("duplicate case ids");
	});

	it("delegates generated code to a caller-provided sandbox", async () => {
		const benchmarkCase = createSandboxedCodingCase({
			execute: async ({ tests }) => ({
				compiled: true,
				passedTests: tests.length,
				totalTests: tests.length,
			}),
		});
		const evaluation = await benchmarkCase.evaluate?.(
			{
				content: "export function solve() { return 1; }",
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
			},
			{
				caseId: benchmarkCase.id,
				run: 1,
				seed: 9,
				target: { id: "target", model: "target" },
				warmup: false,
			},
		);
		expect(evaluation).toMatchObject({ passed: true, answer: "4/4" });
	});
});
