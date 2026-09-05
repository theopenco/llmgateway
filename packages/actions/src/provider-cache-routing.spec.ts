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
		const cfg = applyRoutingPreference(getDefaultRoutingConfig(), "price");
		cfg.thresholds.cacheHitRate = 0;
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
