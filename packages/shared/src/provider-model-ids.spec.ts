import { describe, expect, it } from "vitest";

import { getModelIdsByProviderAndKind } from "./provider-model-ids.js";

describe("getModelIdsByProviderAndKind", () => {
	it("groups each live mapping by its request surface", () => {
		const grouped = getModelIdsByProviderAndKind(new Date("2026-09-04"));

		expect(grouped.get("openai")?.text).toContain("gpt-5.6-sol");
		expect(grouped.get("openai")?.image).toContain("gpt-image-2");
		expect(grouped.get("openai")?.embedding).toContain(
			"text-embedding-3-small",
		);
		expect(grouped.get("mistral")?.ocr).toContain("mistral-ocr-latest");
	});

	it("classifies multimodal image output without a dedicated mapping flag", () => {
		const grouped = getModelIdsByProviderAndKind(new Date("2026-09-04"));

		expect(grouped.get("google-ai-studio")?.image).toContain(
			"gemini-3.1-flash-lite-image",
		);
		expect(grouped.get("google-ai-studio")?.text).not.toContain(
			"gemini-3.1-flash-lite-image",
		);
	});

	it("does not group unsupported non-text request surfaces as text", () => {
		const grouped = getModelIdsByProviderAndKind(new Date("2026-09-04"));

		expect(grouped.get("openai")?.text).not.toContain("tts-1");
	});
});
