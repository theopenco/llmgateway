import { describe, expect, it } from "vitest";

import { models } from "@llmgateway/models";

import { getValidationModel } from "./validate-provider-key.js";

describe("getValidationModel", () => {
	it("never selects an OCR model for provider key validation", () => {
		// The OCR model has zero token prices, which would otherwise make it the
		// cheapest (first) candidate. It must be excluded so key validation calls
		// the chat-completions endpoint with a real chat model.
		const selected = getValidationModel("mistral");
		expect(selected).not.toBeNull();
		expect(selected?.modelId).not.toBe("mistral-ocr-latest");

		const selectedDef = models.find((m) => m.id === selected?.modelId);
		const usesOcr = selectedDef?.providers.some(
			(p) => p.providerId === "mistral" && (p as { ocr?: boolean }).ocr,
		);
		expect(usesOcr).toBeFalsy();
	});
});
