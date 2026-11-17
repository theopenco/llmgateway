import { describe, expect, it } from "vitest";

import { openaiModels } from "./models/openai.js";

import type { ModelDefinition } from "./models.js";

const find = (modelId: string, providerId: string) =>
	(openaiModels as readonly ModelDefinition[])
		.find((entry) => entry.id === modelId)
		?.providers.find((mapping) => mapping.providerId === providerId);

describe("Azure OpenAI retirements", () => {
	it.each(["gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano"])(
		"keeps azure/%s live until April 14, 2027",
		(modelId) => {
			const azure = find(modelId, "azure");
			expect(azure?.deactivatedAt).toEqual(new Date("2027-04-14"));
			expect(azure?.deprecatedAt).toBeUndefined();
		},
	);

	it.each(["gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini"])(
		"shuts down openai/%s on January 14, 2027, before azure",
		(modelId) => {
			expect(find(modelId, "openai")?.deactivatedAt).toEqual(
				new Date("2027-01-14"),
			);
		},
	);
});
