import { describe, expect, it } from "vitest";

import { models } from "./models.js";

describe("model metadata", () => {
	it("uses Azure Foundry limits for Grok 4.3", () => {
		const grok43 = models.find((model) => model.id === "grok-4-3");
		const azure = grok43?.providers.find(
			(provider) => provider.providerId === "azure-ai-foundry",
		);

		expect(azure).toMatchObject({
			contextSize: 20_000,
			maxOutput: 8_192,
		});
	});
});
