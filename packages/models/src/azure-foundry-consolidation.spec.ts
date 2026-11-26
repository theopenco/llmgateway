import { describe, expect, it } from "vitest";

import { models } from "./models.js";
import { getProviderDefinition, usesEncryptedReasoning } from "./providers.js";

import type { ModelDefinition } from "./models.js";

const catalogue: readonly ModelDefinition[] = models;
describe("Azure AI Foundry consolidation", () => {
	it.each(["grok-4-1-fast-reasoning", "grok-4-3"])(
		"serves %s on the azure provider",
		(modelId) => {
			const azure = catalogue
				.find((entry) => entry.id === modelId)
				?.providers.find((mapping) => mapping.providerId === "azure");
			expect(azure).toMatchObject({
				contextSize: modelId === "grok-4-3" ? 200_000 : 128_000,
				maxOutput: modelId === "grok-4-3" ? 8_192 : 128_000,
				streaming: true,
				reasoning: true,
				tools: true,
			});
			expect(azure).not.toHaveProperty("deactivatedAt");
			expect(azure?.supportsResponsesApi).not.toBe(true);
		},
	);

	it("removes the legacy provider and its mappings", () => {
		expect(getProviderDefinition("azure-ai-foundry")).toBeUndefined();
		expect(
			catalogue.some((model) =>
				model.providers.some(
					(mapping) => (mapping.providerId as string) === "azure-ai-foundry",
				),
			),
		).toBe(false);
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

it.each(["azure"] as const)(
	"keeps vision enabled and inlines remote Grok images on %s",
	(providerId) => {
		const mapping = catalogue
			.find((model) => model.id === "grok-4-1-fast-reasoning")
			?.providers.find((provider) => provider.providerId === providerId);
		expect(mapping?.vision).toBe(true);
		expect(mapping?.requiresBase64Images).toBe(true);
	},
);
