import { describe, it, expect } from "vitest";

import { completionsRequestSchema } from "./completions.js";

describe("completionsRequestSchema reasoning_effort", () => {
	it('preserves top-level reasoning_effort "max" (Anthropic honors it natively; providers without a max tier alias it to high downstream)', () => {
		const result = completionsRequestSchema.safeParse({
			model: "deepseek-v4",
			messages: [{ role: "user", content: "hi" }],
			reasoning_effort: "max",
		});

		expect(result.success).toBe(true);
		expect(result.data?.reasoning_effort).toBe("max");
	});

	it('preserves nested reasoning.effort "max"', () => {
		const result = completionsRequestSchema.safeParse({
			model: "deepseek-v4",
			messages: [{ role: "user", content: "hi" }],
			reasoning: { effort: "max" },
		});

		expect(result.success).toBe(true);
		expect(result.data?.reasoning?.effort).toBe("max");
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
