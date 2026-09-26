import { describe, expect, it } from "vitest";

import { computeModelBreakdown } from "./coding-agents-shared";

import type { ApiLog } from "./coding-agents-shared";

describe("agent model totals", () => {
	it("counts a fallback once while preserving billed tokens and costs from both attempts", () => {
		const attempts = [
			{
				usedModel: "fixture/model",
				usedProvider: "fixture",
				retriedByLogId: "final",
				promptTokens: "10",
				completionTokens: "2",
				totalTokens: "12",
				cost: 0.1,
			},
			{
				usedModel: "fixture/model",
				usedProvider: "fixture",
				retriedByLogId: null,
				promptTokens: "20",
				completionTokens: "3",
				totalTokens: "23",
				cost: 0.2,
			},
		] as ApiLog[];
		expect(computeModelBreakdown(attempts)).toEqual([
			expect.objectContaining({
				requestCount: 1,
				promptTokens: 30,
				completionTokens: 5,
				totalTokens: 35,
				cost: 0.1 + 0.2,
			}),
		]);
	});
});
