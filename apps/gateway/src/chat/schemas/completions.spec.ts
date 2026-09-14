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

describe("Gemini replay metadata", () => {
	it("preserves text and tool signatures through validation", () => {
		const extra_content = { google: { thought_signature: "test-signature" } };
		const message = {
			role: "assistant",
			content: [{ type: "text", text: "Answer", extra_content }],
			tool_calls: [
				{
					id: "call_test",
					type: "function",
					function: { name: "lookup", arguments: "{}" },
					extra_content,
				},
			],
			reasoning_details: [
				{
					type: "reasoning.text",
					format: "google-gemini-v1",
					signature: "test-signature",
				},
			],
		};
		const result = completionsRequestSchema.parse({
			model: "gemini-3.5-flash",
			messages: [message],
		});
		expect(result.messages[0]).toEqual(message);
	});
});
