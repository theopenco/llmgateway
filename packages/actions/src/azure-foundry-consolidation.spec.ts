import { describe, expect, it, vi } from "vitest";

import { metricsKey } from "@llmgateway/db";

import { getCheapestFromAvailableProviders } from "./get-cheapest-from-available-providers.js";
import { getProviderEndpoint } from "./get-provider-endpoint.js";

import type {
	SessionProviderEntry,
	SessionProviderStore,
} from "./get-cheapest-from-available-providers.js";

describe("Azure Foundry consolidation", () => {
	it.each(["grok-4-1-fast-reasoning", "grok-4-3"])(
		"routes %s through Azure's v1 Chat Completions API",
		(modelId) => {
			const endpoint = getProviderEndpoint(
				"azure",
				undefined,
				modelId,
				undefined,
				false,
				true,
				false,
				{
					env_config: {
						resource: "test-resource",
						deploymentType: "ai-foundry",
						useResponsesApi: "true",
					},
				},
				undefined,
				false,
				undefined,
				true,
				modelId,
			);
			expect(endpoint).toBe(
				"https://test-resource.openai.azure.com/openai/v1/chat/completions",
			);
		},
	);

	it("re-pins low-uptime Azure sessions when reasoning is not provider-bound", async () => {
		const model = {
			id: "azure-unbound-reasoning-test",
			providers: ["azure", "deepseek"].map((providerId) => ({
				providerId,
				externalId: "azure-unbound-reasoning-test",
				inputPrice: "1e-6",
				outputPrice: "2e-6",
				reasoning: true,
				encryptedReasoning: false,
			})),
		};
		const metricsMap = new Map(
			model.providers.map((provider) => [
				metricsKey(model.id, provider.providerId, undefined),
				{
					modelId: model.id,
					providerId: provider.providerId,
					uptime: provider.providerId === "azure" ? 50 : 100,
					averageLatency: 200,
					throughput: 100,
					totalRequests: 100,
				},
			]),
		);
		let pinned: SessionProviderEntry | null = { providerId: "azure" };
		const store: SessionProviderStore = {
			get: async () => pinned,
			set: async (providerId, region) => {
				pinned = { providerId, region };
			},
		};
		const result = await getCheapestFromAvailableProviders(
			model.providers,
			model,
			{ metricsMap, sessionProviderStore: store },
		);
		expect(result?.provider.providerId).toBe("deepseek");
		expect(pinned).toEqual({ providerId: "deepseek", region: undefined });
	});

	it("allows exploration for reasoning mappings that opt out of binding", async () => {
		const originalArgv = process.argv;
		process.argv = ["node", "routing-probe.mjs"];
		vi.stubEnv("NODE_ENV", undefined);
		vi.stubEnv("VITEST", undefined);
		vi.stubEnv("EXPLORATION_RATE", "1");
		try {
			const model = {
				id: "azure-unbound-exploration-test",
				providers: ["azure", "deepseek"].map((providerId) => ({
					providerId,
					externalId: "azure-unbound-exploration-test",
					inputPrice: "1e-6",
					outputPrice: "2e-6",
					reasoning: true,
					encryptedReasoning: false,
				})),
			};
			const result = await getCheapestFromAvailableProviders(
				model.providers,
				model,
			);
			expect(result?.metadata.selectionReason).toBe("random-exploration");
		} finally {
			process.argv = originalArgv;
			vi.unstubAllEnvs();
		}
	});
});
