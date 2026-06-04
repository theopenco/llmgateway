import { describe, it, expect } from "vitest";

import { completionsRequestSchema } from "./completions.js";

describe("completionsRequestSchema reasoning_effort", () => {
	it('accepts top-level reasoning_effort "max" and normalizes it to "high"', () => {
		const result = completionsRequestSchema.safeParse({
			model: "deepseek-v4",
			messages: [{ role: "user", content: "hi" }],
			reasoning_effort: "max",
		});

		expect(result.success).toBe(true);
		expect(result.data?.reasoning_effort).toBe("high");
	});

	it('normalizes nested reasoning.effort "max" to "high"', () => {
		const result = completionsRequestSchema.safeParse({
			model: "deepseek-v4",
			messages: [{ role: "user", content: "hi" }],
			reasoning: { effort: "max" },
		});

		expect(result.success).toBe(true);
		expect(result.data?.reasoning?.effort).toBe("high");
	});

	it("leaves other effort levels unchanged", () => {
		const result = completionsRequestSchema.safeParse({
			model: "deepseek-v4",
			messages: [{ role: "user", content: "hi" }],
			reasoning_effort: "xhigh",
		});

		expect(result.success).toBe(true);
		expect(result.data?.reasoning_effort).toBe("xhigh");
	});
});
