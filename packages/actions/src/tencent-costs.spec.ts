import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { calculateCosts } from "./costs.js";

vi.mock("@llmgateway/db", () => ({
	getEffectiveDiscount: async () => ({ discount: "0", source: "none" }),
}));

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-10-29T12:00:00Z"));
});

afterEach(() => {
	vi.useRealTimers();
});

describe("Tencent observed usage costs", () => {
	it.each([
		["glm-5.3", 16, 33, 31, 0.0001676],
		["glm-5.3-flash", 16, 27, 22, 0.0000159],
		["glm-5.3-flashx", 16, 101, 97, 0.00013217],
		["kimi-k2.8-preview", 89, 66, 50, 0.000353],
		["mimo-v2.6-pro", 11, 14, 11, 0.000016965],
		["mimo-v2.6-flash", 11, 14, 11, 0.00000546],
		["step-5-preview", 15, 24, 0, 0.0000798],
		["deepseek-v4.1-flash", 34, 16, 14, 0.0000147],
		["deepseek-v4.1-flash-1017", 34, 11, 9, 0.0000117],
		["deepseek-v4-pro", 87, 15, 13, 0.00008712],
		["deepseek-v4-flash", 34, 12, 10, 0.0000123],
	] as const)(
		"bills %s without counting reasoning twice",
		async (model, prompt, completion, reasoning, expected) => {
			const result = await calculateCosts(
				model,
				"tencent",
				null,
				prompt,
				completion,
				0,
				undefined,
				reasoning,
			);
			expect(result.totalCost).toBeCloseTo(expected, 12);
			expect(result.completionTokens).toBe(completion);
		},
	);

	it.each([
		["glm-5.3", 157, 128, 12, 0.00012668],
		["deepseek-v4.1-flash", 288, 256, 45, 0.000032568],
	] as const)(
		"subtracts cached tokens from the prompt for %s",
		async (model, prompt, cached, completion, expected) => {
			const result = await calculateCosts(
				model,
				"tencent",
				null,
				prompt,
				completion,
				cached,
			);
			expect(result.totalCost).toBeCloseTo(expected, 12);
		},
	);

	it.each([
		["2026-10-29T00:59:59Z", 0.0000147],
		["2026-10-29T01:00:00Z", 0.0000294],
		["2026-10-29T04:00:00Z", 0.0000147],
		["2026-10-29T06:00:00Z", 0.0000294],
		["2026-10-29T10:00:00Z", 0.0000147],
		["2026-10-31T02:00:00Z", 0.0000147],
	] as const)(
		"uses the correct billing period at %s",
		async (time, expected) => {
			vi.setSystemTime(new Date(time));
			const result = await calculateCosts(
				"deepseek-v4.1-flash",
				"tencent",
				null,
				34,
				16,
				0,
			);
			expect(result.totalCost).toBeCloseTo(expected, 12);
		},
	);
});
