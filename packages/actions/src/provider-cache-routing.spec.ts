import { afterEach, describe, expect, it, vi } from "vitest";

import { metricsKey, type ProviderMetrics } from "@llmgateway/db";
import { models, type ModelDefinition } from "@llmgateway/models";
import {
	applyRoutingPreference,
	getDefaultRoutingConfig,
	resolveRoutingConfig,
} from "@llmgateway/shared/routing-config";

import { getCheapestFromAvailableProviders } from "./get-cheapest-from-available-providers.js";

const model = models.find(
	(m) => m.id === "deepseek-v4-flash",
) as ModelDefinition;
const candidates = model.providers.filter((p) =>
	["deepseek", "deepinfra", "fireworks"].includes(p.providerId),
);

afterEach(() => vi.useRealTimers());

function usageMetrics(hitRate = 0.995, outputRatio = 0.005) {
	return new Map<string, ProviderMetrics>(
		candidates.map((p) => [
			metricsKey(model.id, p.providerId),
			{
				modelId: model.id,
				providerId: p.providerId,
				totalRequests: 100,
				uptime: 100,
				cacheHitRate: hitRate,
				cacheOutputRatio: outputRatio,
			},
		]),
	);
}

async function select(
	metricsMap?: Map<string, ProviderMetrics>,
	promptTokens = 100_000,
) {
	return await getCheapestFromAvailableProviders(candidates, model, {
		metricsMap,
		promptTokens,
		routingConfig: applyRoutingPreference(getDefaultRoutingConfig(), "price"),
	});
}

describe("routing with observed cache usage", () => {
	it.each([0.1, 0.05, 0])(
		"does not reward cache support at a %s hit rate",
		async (hitRate) => {
			const apiModel = {
				id: "api-cache-test",
				providers: [
					{
						providerId: "openai" as const,
						externalId: "api-cache-test",
						inputPrice: "0.6e-6",
						cachedInputPrice: "0.11e-6",
						outputPrice: "2.2e-6",
					},
					{
						providerId: "deepseek" as const,
						externalId: "api-cache-test",
						inputPrice: "0.45e-6",
						outputPrice: "2e-6",
					},
				],
			};
			const metricsMap = new Map(
				apiModel.providers.map((p) => [
					metricsKey(apiModel.id, p.providerId),
					{
						modelId: apiModel.id,
						providerId: p.providerId,
						totalRequests: 100,
						uptime: 100,
						cacheHitRate: hitRate,
						cacheOutputRatio: 0.1,
					},
				]),
			);
			const result = await getCheapestFromAvailableProviders(
				apiModel.providers,
				apiModel,
				{
					metricsMap,
					promptTokens: 10_000,
					routingConfig: resolveRoutingConfig(null, { openai: 1, deepseek: 1 }),
				},
			);
			expect(result?.provider.providerId).toBe("deepseek");
		},
	);

	it.each([
		["default", true, "openai"],
		["chat", true, "openai"],
		["devpass", true, "deepseek"],
		["devpass", "score-only", "deepseek"],
		["devpass", false, "openai"],
	] as const)(
		"uses %s defaults for a short prompt with session=%s",
		async (kind, session, expected) => {
			const codingModel = {
				id: "coding-cache-test",
				providers: [
					{
						providerId: "openai" as const,
						externalId: "coding-cache-test",
						inputPrice: "1e-6",
						cachedInputPrice: "0.5e-6",
						outputPrice: "1e-6",
					},
					{
						providerId: "deepseek" as const,
						externalId: "coding-cache-test",
						inputPrice: "2e-6",
						cachedInputPrice: "0.1e-6",
						outputPrice: "3e-6",
					},
				],
			};
			const set = vi.fn();
			const result = await getCheapestFromAvailableProviders(
				codingModel.providers,
				codingModel,
				{
					promptTokens: 100,
					session: session === "score-only",
					routingConfig: resolveRoutingConfig(
						null,
						{ openai: 1, deepseek: 1 },
						kind,
					),
					sessionProviderStore:
						session === true ? { get: async () => null, set } : undefined,
				},
			);
			expect(result?.provider.providerId).toBe(expected);
			if (session === true) {
				expect(set).toHaveBeenCalledWith(expected, undefined);
			} else {
				expect(set).not.toHaveBeenCalled();
			}
		},
	);

	it("reproduces the DeepInfra preference with the default token mix", async () => {
		expect((await select())?.provider.providerId).toBe("deepinfra");
	});

	it.each([
		["2026-09-04T02:00:00Z", "fireworks"],
		["2026-09-04T12:00:00Z", "deepseek"],
	])("selects the cheaper cached workload at %s", async (now, expected) => {
		vi.setSystemTime(new Date(now));
		const result = await select(usageMetrics());
		expect(result?.provider.providerId).toBe(expected);
		const scores = result!.metadata.providerScores;
		const winner = scores.find((s) => s.providerId === expected)!;
		const deepinfra = scores.find((s) => s.providerId === "deepinfra")!;
		expect(winner.price / deepinfra.price).toBeLessThan(0.7);
	});

	it("charges cache misses when a provider has a low observed hit rate", async () => {
		const metrics = usageMetrics();
		for (const m of metrics.values()) {
			if (m.providerId !== "deepinfra") {
				m.cacheHitRate = 0.5;
			}
		}
		expect((await select(metrics))?.provider.providerId).toBe("deepinfra");
	});

	it("keeps output cost relevant for output-heavy workloads", async () => {
		expect((await select(usageMetrics(0.995, 0.5)))?.provider.providerId).toBe(
			"deepinfra",
		);
	});

	it("does not apply cached-workload assumptions to small prompts", async () => {
		expect((await select(usageMetrics(), 100))?.provider.providerId).toBe(
			"deepinfra",
		);
	});

	it("honors disabling cached-input pricing", async () => {
		const cfg = applyRoutingPreference(
			resolveRoutingConfig({ thresholds: { cacheHitRate: 0 } }, {}),
			"price",
		);
		const result = await getCheapestFromAvailableProviders(candidates, model, {
			metricsMap: usageMetrics(),
			promptTokens: 100_000,
			routingConfig: cfg,
		});
		expect(result?.provider.providerId).toBe("deepinfra");
	});

	it("honors explicit pricing assumptions over observed usage", async () => {
		const cfg = applyRoutingPreference(
			resolveRoutingConfig(
				{
					thresholds: { cacheHitRate: 0.7, cacheOutputRatio: 0.2 },
				},
				{},
			),
			"price",
		);
		const result = await getCheapestFromAvailableProviders(candidates, model, {
			metricsMap: usageMetrics(),
			promptTokens: 100_000,
			routingConfig: cfg,
		});
		expect(result?.provider.providerId).toBe("deepinfra");
	});

	it("preserves a healthy session's warm provider", async () => {
		const set = vi.fn();
		const result = await getCheapestFromAvailableProviders(candidates, model, {
			metricsMap: usageMetrics(),
			promptTokens: 100_000,
			routingConfig: applyRoutingPreference(getDefaultRoutingConfig(), "price"),
			sessionProviderStore: {
				get: async () => ({ providerId: "deepinfra" }),
				set,
			},
		});
		expect(result?.provider.providerId).toBe("deepinfra");
		expect(set).toHaveBeenCalledWith("deepinfra", undefined);
	});
});
