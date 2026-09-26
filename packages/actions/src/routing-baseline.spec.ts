import { beforeEach, describe, expect, it, vi } from "vitest";

import { calculateCosts } from "./costs.js";
import {
	computeRoutingBaseline,
	getDynamicRouteBaselineCandidates,
	isRoutedRequestedModel,
	prefetchRoutingBaselineDiscounts,
	resolveCatalogueCandidate,
} from "./routing-baseline.js";

const { mockGetEffectiveDiscount } = vi.hoisted(() => ({
	mockGetEffectiveDiscount: vi.fn(),
}));

vi.mock("@llmgateway/db", () => ({
	getEffectiveDiscount: mockGetEffectiveDiscount,
}));

const opus = { modelId: "claude-opus-4-6", providerId: "anthropic" };
const haiku = { modelId: "claude-haiku-4-5", providerId: "anthropic" };

async function totalCost(modelId: string, prompt: number, completion: number) {
	const costs = await calculateCosts(
		modelId,
		"anthropic",
		null,
		prompt,
		completion,
	);
	return costs.totalCost!;
}

describe("computeRoutingBaseline", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		vi.mocked(mockGetEffectiveDiscount).mockResolvedValue({
			discount: "0",
			source: "none",
		});
	});

	it("prices the request on the priciest candidate", async () => {
		const haikuCost = await totalCost("claude-haiku-4-5", 1000, 500);
		const baseline = await computeRoutingBaseline({
			candidates: [haiku, opus],
			usage: { promptTokens: "1000", completionTokens: "500" },
			actualCost: haikuCost,
			actualModel: "anthropic/claude-haiku-4-5",
			organizationId: null,
		});

		expect(baseline).toEqual({
			model: "anthropic/claude-opus-4-6",
			cost: await totalCost("claude-opus-4-6", 1000, 500),
		});
		expect(baseline!.cost).toBeGreaterThan(haikuCost);
	});

	it("never falls below the actual cost", async () => {
		const baseline = await computeRoutingBaseline({
			candidates: [haiku],
			usage: { promptTokens: 1000, completionTokens: 500 },
			actualCost: 10,
			actualModel: "openai/gpt-5",
			organizationId: null,
		});

		expect(baseline).toEqual({ model: "openai/gpt-5", cost: 10 });
	});

	it("prices with prefetched discounts without looking them up again", async () => {
		vi.mocked(mockGetEffectiveDiscount).mockResolvedValue({
			discount: "0.5",
			source: "organization",
		});
		const candidates = prefetchRoutingBaselineDiscounts([opus], "org-id");
		expect(mockGetEffectiveDiscount).toHaveBeenCalledTimes(1);

		const baseline = await computeRoutingBaseline({
			candidates,
			usage: { promptTokens: 1000, completionTokens: 500 },
			actualCost: 0,
			actualModel: "anthropic/claude-haiku-4-5",
			organizationId: "org-id",
		});

		expect(mockGetEffectiveDiscount).toHaveBeenCalledTimes(1);
		vi.mocked(mockGetEffectiveDiscount).mockResolvedValue({
			discount: "0",
			source: "none",
		});
		expect(baseline!.cost).toBeCloseTo(
			(await totalCost("claude-opus-4-6", 1000, 500)) / 2,
			10,
		);
	});

	it("returns null for a request without token usage", async () => {
		const baseline = await computeRoutingBaseline({
			candidates: [opus],
			usage: { promptTokens: null, completionTokens: "0" },
			actualCost: 0,
			actualModel: "anthropic/claude-opus-4-6",
			organizationId: null,
		});

		expect(baseline).toBeNull();
	});
});

describe("resolveCatalogueCandidate", () => {
	it("returns undefined for an unknown model", () => {
		expect(resolveCatalogueCandidate("no-such-model")).toBeUndefined();
	});

	it("respects a provider restriction", () => {
		expect(
			resolveCatalogueCandidate("claude-opus-4-6", ["aws-bedrock"]),
		).toEqual({ modelId: "claude-opus-4-6", providerId: "aws-bedrock" });
	});
});

describe("getDynamicRouteBaselineCandidates", () => {
	it("prices catalogue model nodes and skips custom targets", () => {
		const candidates = getDynamicRouteBaselineCandidates({
			entry: "split",
			nodes: [
				{
					id: "split",
					type: "percentage",
					splits: [
						{ weight: 50, next: "cheap" },
						{ weight: 50, next: "custom" },
					],
				},
				{ id: "cheap", type: "model", model: "claude-haiku-4-5" },
				{ id: "custom", type: "model", model: "my-endpoint/llama" },
			],
		});

		expect(candidates).toEqual([resolveCatalogueCandidate("claude-haiku-4-5")]);
	});
});

describe("isRoutedRequestedModel", () => {
	it("matches auto, smart and dynamic routes only", () => {
		expect(isRoutedRequestedModel("auto")).toBe(true);
		expect(isRoutedRequestedModel("smart")).toBe(true);
		expect(isRoutedRequestedModel("dynamic/support")).toBe(true);
		expect(isRoutedRequestedModel("openai/gpt-5")).toBe(false);
		expect(isRoutedRequestedModel("claude-opus-4-6")).toBe(false);
	});
});
