import { describe, expect, it } from "vitest";

import { models } from "./models.js";
import {
	getProviderDefinition,
	isLiveMapping,
	usesEncryptedReasoning,
} from "./providers.js";

import type { ModelDefinition } from "./models.js";

const catalogue: readonly ModelDefinition[] = models;
const retirement = new Date("2026-11-07T00:00:00.000Z");

describe("Azure AI Foundry consolidation", () => {
	it.each(["grok-4-1-fast-reasoning", "grok-4-3"])(
		"keeps %s available on both providers during the notice period",
		(modelId) => {
			const model = catalogue.find((entry) => entry.id === modelId);
			const legacy = model?.providers.find(
				(mapping) => mapping.providerId === "azure-ai-foundry",
			);
			const azure = model?.providers.find(
				(mapping) => mapping.providerId === "azure",
			);

			expect(azure).toMatchObject({
				contextSize: modelId === "grok-4-3" ? 200_000 : 128_000,
				maxOutput: modelId === "grok-4-3" ? 8_192 : 128_000,
			});

			expect(legacy).toBeDefined();
			expect(azure).toBeDefined();
			expect(azure).toMatchObject({
				externalId: legacy?.externalId,
				inputPrice: legacy?.inputPrice,
				outputPrice: legacy?.outputPrice,
				streaming: true,
				reasoning: true,
				tools: true,
			});
			expect(azure).not.toHaveProperty("deactivatedAt");
			expect(azure?.supportsResponsesApi).not.toBe(true);
			expect(legacy?.deactivatedAt).toEqual(retirement);
			if (!legacy || !azure) {
				throw new Error("Azure mapping missing");
			}
			expect(isLiveMapping(legacy, new Date("2026-11-06T23:59:59.999Z"))).toBe(
				true,
			);
			expect(isLiveMapping(legacy, retirement)).toBe(false);
			expect(isLiveMapping(azure, retirement)).toBe(true);
		},
	);

	it("leaves the already retired non-reasoning mapping unchanged", () => {
		const model = catalogue.find(
			(entry) => entry.id === "grok-4-1-fast-non-reasoning",
		);
		expect(
			model?.providers.find(
				(mapping) => mapping.providerId === "azure-ai-foundry",
			)?.deactivatedAt,
		).toEqual(new Date("2026-10-28"));
		expect(
			model?.providers.some((mapping) => mapping.providerId === "azure"),
		).toBe(false);
	});

	it("retains the legacy provider and publishes its migration notice", () => {
		const provider = getProviderDefinition("azure-ai-foundry");
		expect(provider?.name).toContain("Legacy");
		expect(provider?.announcement).toContain("2026-11-07");
		expect(provider?.announcement).toContain("Azure");
	});
});

describe("per-mapping reasoning binding", () => {
	it("allows a mixed provider's mapping to opt out of bound reasoning", () => {
		const mapping = {
			providerId: "azure",
			reasoning: true,
			encryptedReasoning: false,
		};
		expect(usesEncryptedReasoning(mapping)).toBe(false);
	});

	it("keeps provider defaults for existing reasoning mappings", () => {
		expect(
			usesEncryptedReasoning({ providerId: "azure", reasoning: true }),
		).toBe(true);
		expect(
			usesEncryptedReasoning({ providerId: "openai", reasoning: true }),
		).toBe(true);
	});

	it("requires reasoning support even when binding is explicitly enabled", () => {
		const mapping = {
			providerId: "azure",
			reasoning: false,
			encryptedReasoning: true,
		};
		expect(usesEncryptedReasoning(mapping)).toBe(false);
		expect(usesEncryptedReasoning(undefined)).toBe(false);
	});
});

it.each(["grok-4-1-fast-reasoning", "grok-4-3"])(
	"does not bind the migrated Azure %s reasoning to a credential",
	(modelId) => {
		const mapping = catalogue
			.find((model) => model.id === modelId)
			?.providers.find((provider) => provider.providerId === "azure");
		expect(mapping?.encryptedReasoning).toBe(false);
		expect(usesEncryptedReasoning(mapping)).toBe(false);
	},
);

it("can enable binding per mapping without changing a provider default", () => {
	const mapping = {
		providerId: "deepseek",
		reasoning: true,
		encryptedReasoning: true,
	};
	expect(usesEncryptedReasoning(mapping)).toBe(true);
	const withoutReasoning = { providerId: "deepseek", encryptedReasoning: true };
	expect(usesEncryptedReasoning(withoutReasoning)).toBe(false);
});

it.each(["azure", "azure-ai-foundry"] as const)(
	"keeps vision enabled and inlines remote Grok images on %s",
	(providerId) => {
		const mapping = catalogue
			.find((model) => model.id === "grok-4-1-fast-reasoning")
			?.providers.find((provider) => provider.providerId === providerId);
		expect(mapping?.vision).toBe(true);
		expect(mapping?.requiresBase64Images).toBe(true);
	},
);
