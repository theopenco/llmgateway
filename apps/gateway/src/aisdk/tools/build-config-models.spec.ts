import { describe, expect, test } from "vitest";

import { buildConfigModels } from "./build-config-models.js";

import type { ModelDefinition } from "@llmgateway/models";

describe("filtered SDK model identifiers", () => {
	test("keeps a custom provider's already-qualified routing prefix", () => {
		const models: ModelDefinition[] = [
			{
				id: "private/my-model",
				name: "Private model",
				family: "custom",
				providers: [
					{ providerId: "custom", externalId: "my-model", streaming: true },
				],
			},
		];
		const entries = buildConfigModels(new Date(), models);
		expect(entries.map((entry) => entry.id)).toEqual(["private/my-model"]);
		expect(entries[0].specification.modelId).toBe("private/my-model");
	});

	test("keeps canonical models provider-qualified", () => {
		const models: ModelDefinition[] = [
			{
				id: "canonical-model",
				name: "Canonical model",
				family: "test",
				providers: [
					{
						providerId: "openai",
						externalId: "upstream-model",
						streaming: true,
					},
				],
			},
		];
		expect(
			buildConfigModels(new Date(), models).map((entry) => entry.id),
		).toEqual(["openai/canonical-model"]);
	});
});
