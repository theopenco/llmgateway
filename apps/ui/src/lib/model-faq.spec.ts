import { describe, expect, it } from "vitest";

import { buildModelFaqs } from "./model-faq";

import type { ModelDefinition } from "@llmgateway/models";

// Minimal model fixture — only the fields the FAQ builder reads.
function model(id: string): ModelDefinition {
	return {
		id,
		name: id,
		family: "test",
		providers: [],
	};
}

describe("buildModelFaqs — JSON capability truthfulness", () => {
	it("does not claim structured outputs when only soft jsonOutput is supported (qwen case)", () => {
		const faqs = buildModelFaqs(model("qwen3.7-flash"), [
			{
				providerId: "alibaba",
				tools: true,
				jsonOutput: true,
				jsonOutputSchema: false,
			},
		]);
		const faq = faqs.find((f) => f.question.includes("structured outputs"))!;
		expect(faq).toBeDefined();
		expect(faq.answer).not.toContain("structured JSON outputs");
		expect(faq.answer.toLowerCase()).toContain("soft");
	});

	it("claims strict JSON output schema only when jsonOutputSchema is true (gpt-4o-mini case)", () => {
		const faqs = buildModelFaqs(model("gpt-4o-mini"), [
			{
				providerId: "openai",
				tools: true,
				jsonOutput: true,
				jsonOutputSchema: true,
			},
		]);
		const faq = faqs.find((f) => f.question.includes("structured outputs"))!;
		expect(faq).toBeDefined();
		expect(faq.answer).toContain("JSON output schema");
		expect(faq.answer).toContain("upstream-enforced");
	});

	it("mentions soft JSON output when the model supports neither tools nor strict schema", () => {
		const faqs = buildModelFaqs(model("soft-only-model"), [
			{ providerId: "alibaba", jsonOutput: true, jsonOutputSchema: false },
		]);
		const faq = faqs.find((f) => f.question.includes("structured outputs"))!;
		expect(faq.answer).toContain("soft JSON output");
		expect(faq.answer).not.toContain("structured JSON outputs");
	});

	it("does not claim soft JSON output for tool-only models (CodeRabbit)", () => {
		const faqs = buildModelFaqs(model("tool-only-model"), [
			{
				providerId: "acme",
				tools: true,
				jsonOutput: false,
				jsonOutputSchema: false,
			},
		]);
		const faq = faqs.find((f) => f.question.includes("structured outputs"))!;
		expect(faq.answer).toContain("tool (function) calling");
		expect(faq.answer).not.toContain("soft JSON output");
		expect(faq.answer).not.toContain("strict JSON output schema");
	});

	it("denies tools and structured outputs when nothing is supported", () => {
		const faqs = buildModelFaqs(model("no-capability-model"), [
			{
				providerId: "acme",
				tools: false,
				jsonOutput: false,
				jsonOutputSchema: false,
			},
		]);
		const faq = faqs.find((f) => f.question.includes("structured outputs"))!;
		expect(faq.answer).toContain("does not currently support");
	});
});
