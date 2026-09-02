import { describe, it, expect } from "vitest";

import { completionsRequestSchema } from "./completions.js";

describe("completionsRequestSchema message roles", () => {
	it("accepts every Chat Completions message role", () => {
		for (const role of [
			"developer",
			"system",
			"user",
			"assistant",
			"tool",
			"function",
		]) {
			const result = completionsRequestSchema.safeParse({
				model: "gpt-5",
				messages: [{ role, content: "hi" }],
			});
			expect(result.success).toBe(true);
		}
	});

	it("rejects unknown message roles", () => {
		const result = completionsRequestSchema.safeParse({
			model: "gpt-5",
			messages: [{ role: "invalid", content: "hi" }],
		});
		expect(result.success).toBe(false);
	});
});

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

describe("completionsRequestSchema routing", () => {
	it("accepts the supported routing strategies", () => {
		for (const routing of ["auto", "price", "throughput", "latency"] as const) {
			const result = completionsRequestSchema.safeParse({
				model: "deepseek-v4",
				messages: [{ role: "user", content: "hi" }],
				routing,
			});
			expect(result.success).toBe(true);
			expect(result.data?.routing).toBe(routing);
		}
	});

	it("leaves routing undefined when omitted", () => {
		const result = completionsRequestSchema.safeParse({
			model: "deepseek-v4",
			messages: [{ role: "user", content: "hi" }],
		});
		expect(result.success).toBe(true);
		expect(result.data?.routing).toBeUndefined();
	});

	it("rejects unknown routing strategies", () => {
		const result = completionsRequestSchema.safeParse({
			model: "deepseek-v4",
			messages: [{ role: "user", content: "hi" }],
			routing: "balanced",
		});
		expect(result.success).toBe(false);
	});
});

describe("completionsRequestSchema stop and seed", () => {
	const base = {
		model: "gpt-5",
		messages: [{ role: "user", content: "hi" }],
	};

	it("accepts a single stop string", () => {
		const result = completionsRequestSchema.safeParse({ ...base, stop: "\n" });
		expect(result.success).toBe(true);
		expect(result.data?.stop).toBe("\n");
	});

	it("accepts up to 4 stop sequences", () => {
		const result = completionsRequestSchema.safeParse({
			...base,
			stop: ["a", "b", "c", "d"],
		});
		expect(result.success).toBe(true);
		expect(result.data?.stop).toEqual(["a", "b", "c", "d"]);
	});

	it("rejects more than 4 stop sequences", () => {
		const result = completionsRequestSchema.safeParse({
			...base,
			stop: ["a", "b", "c", "d", "e"],
		});
		expect(result.success).toBe(false);
	});

	it("normalizes null stop to undefined", () => {
		const result = completionsRequestSchema.safeParse({ ...base, stop: null });
		expect(result.success).toBe(true);
		expect(result.data?.stop).toBeUndefined();
	});

	it("normalizes an empty stop array to undefined", () => {
		const result = completionsRequestSchema.safeParse({ ...base, stop: [] });
		expect(result.success).toBe(true);
		expect(result.data?.stop).toBeUndefined();
	});

	it("accepts an integer seed", () => {
		const result = completionsRequestSchema.safeParse({ ...base, seed: 42 });
		expect(result.success).toBe(true);
		expect(result.data?.seed).toBe(42);
	});

	it("rejects a non-integer seed", () => {
		const result = completionsRequestSchema.safeParse({ ...base, seed: 1.5 });
		expect(result.success).toBe(false);
	});

	it("normalizes null seed to undefined", () => {
		const result = completionsRequestSchema.safeParse({ ...base, seed: null });
		expect(result.success).toBe(true);
		expect(result.data?.seed).toBeUndefined();
	});
});
