import { describe, expect, it } from "vitest";

import { openaiModels } from "./models/openai.js";

import type { ModelDefinition } from "./models.js";

describe("Azure OpenAI retirements", () => {
	it.each(["gpt-4o", "gpt-4o-mini", "gpt-4.1-mini"])(
		"retires azure/%s on April 14, 2027 without retiring other providers",
		(modelId) => {
			const model = (openaiModels as readonly ModelDefinition[]).find(
				(entry) => entry.id === modelId,
			);
			const azure = model?.providers.find(
				(mapping) => mapping.providerId === "azure",
			);
			expect(azure?.deactivatedAt).toEqual(new Date("2027-04-14"));
			expect(
				model?.providers.find((mapping) => mapping.providerId === "openai")
					?.deactivatedAt,
			).toBeUndefined();
		},
	);
});
