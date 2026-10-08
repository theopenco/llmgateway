import { afterEach, describe, expect, it, vi } from "vitest";

import {
	computeModelBreakdown,
	formatLastActive,
} from "./coding-agents-shared";

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

describe("formatLastActive", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it.each([
		["2026-10-08T14:00:00Z", "Recently"],
		["2026-10-08T13:00:00Z", "1h ago"],
		["2026-10-07T14:00:00Z", "1d ago"],
	])("formats the hour bucket %s as %s", (bucket, expected) => {
		vi.useFakeTimers({ now: new Date("2026-10-08T14:58:00Z") });
		expect(formatLastActive(new Date(bucket))).toBe(expected);
	});
});
