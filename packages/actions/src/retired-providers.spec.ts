import { describe, expect, it } from "vitest";

import {
	getProviderDefinition,
	getProviderEnvConfig,
	models,
	type ModelDefinition,
} from "@llmgateway/models";

import { getProviderEndpoint } from "./get-provider-endpoint.js";
import { getProviderHeaders } from "./get-provider-headers.js";
import { validateProviderKey } from "./validate-provider-key.js";

describe("retired Azure Model Inference provider", () => {
	it("retains its catalogue and historical mapping metadata", () => {
		expect(getProviderDefinition("azure-ai-foundry")).toMatchObject({
			retired: true,
		});
		const catalogue: readonly ModelDefinition[] = models;
		const mappings = catalogue.flatMap((model) =>
			model.providers.filter(
				(mapping) => mapping.providerId === "azure-ai-foundry",
			),
		);
		expect(mappings).toHaveLength(3);
		expect(
			mappings.every(
				(mapping) =>
					mapping.deactivatedAt &&
					mapping.deactivatedAt <= new Date("2026-11-07T00:00:00Z"),
			),
		).toBe(true);
		expect(getProviderEnvConfig("azure-ai-foundry")).toEqual({ required: {} });
	});
	it.each([undefined, "https://example.com"])(
		"rejects inference before resolving base URL %s",
		(baseUrl) => {
			expect(() =>
				getProviderEndpoint("azure-ai-foundry", baseUrl, "grok-4-3"),
			).toThrow(/retired/i);
		},
	);
	it("does not generate authentication headers", () => {
		expect(() => getProviderHeaders("azure-ai-foundry", "test-token")).toThrow(
			/retired/i,
		);
	});
	it("rejects credential validation even when live validation is skipped", async () => {
		expect(
			await validateProviderKey(
				"azure-ai-foundry",
				"test-token",
				undefined,
				true,
			),
		).toMatchObject({ valid: false, error: expect.stringMatching(/retired/i) });
	});
	it("keeps Azure Foundry v1 and Azure Anthropic available", () => {
		expect(
			getProviderEndpoint(
				"azure",
				"https://example.com",
				"grok-4-3",
				undefined,
				false,
				undefined,
				undefined,
				{ azure_deployment_type: "ai-foundry" },
			),
		).toBe("https://example.com/openai/v1/chat/completions");
		expect(getProviderHeaders("azure", "test-token")).toEqual({
			"api-key": "test-token",
		});
		expect(getProviderHeaders("azure-anthropic", "test-token")).toMatchObject({
			"x-api-key": "test-token",
		});
	});
});
