import { describe, it, expect } from "vitest";

import {
	expandAllProviderRegions,
	models,
	type ProviderModelMapping,
} from "@llmgateway/models";

import { applyPinnedDefaultRegions } from "./pin-default-regions.js";

function bedrockCandidates(modelId: string): ProviderModelMapping[] {
	const model = models.find((m) => m.id === modelId);
	if (!model) {
		throw new Error(`unknown model ${modelId}`);
	}
	return expandAllProviderRegions(
		model.providers.filter((p) => p.providerId === "aws-bedrock"),
	);
}

describe("applyPinnedDefaultRegions", () => {
	it("pins Bedrock models with a global profile to the synthetic root + global", () => {
		const pinned = applyPinnedDefaultRegions(
			bedrockCandidates("claude-haiku-4-5-20251001"),
		);
		const regions = pinned.map((m) => m.region ?? "(root)");
		expect(regions).toContain("(root)");
		expect(regions).toContain("global");
		expect(regions).not.toContain("us");
		expect(regions).not.toContain("eu");
	});

	it("pins Bedrock models without a global profile to their concrete region (no synthetic root)", () => {
		// Opus 4.1 only has a `us` cross-region inference profile on Bedrock. The
		// synthetic root would resolve to `global.` which Bedrock rejects, so it
		// must be dropped in favour of the `us` variant.
		const pinned = applyPinnedDefaultRegions(
			bedrockCandidates("claude-opus-4-1-20250805"),
		);
		expect(pinned.map((m) => m.region)).toEqual(["us"]);
	});

	it("applies the same fallback to Llama Bedrock models that lack a global profile", () => {
		const pinned = applyPinnedDefaultRegions(
			bedrockCandidates("llama-3.1-70b-instruct"),
		);
		expect(pinned.map((m) => m.region)).toEqual(["us"]);
	});

	it("keeps the synthetic root for Bedrock mappings that expose no regional variants", () => {
		const mapping: ProviderModelMapping = {
			providerId: "aws-bedrock",
			externalId: "some.legacy-model-v1:0",
			inputPrice: "1e-6",
			outputPrice: "1e-6",
			streaming: true,
		};
		expect(applyPinnedDefaultRegions([mapping])).toEqual([mapping]);
	});

	it("passes everything through when a region was explicitly requested", () => {
		const candidates = bedrockCandidates("claude-opus-4-1-20250805");
		expect(
			applyPinnedDefaultRegions(candidates, { requestedRegion: "us" }),
		).toEqual(candidates);
	});

	it("passes everything through for providers with an explicit region lock", () => {
		const candidates = bedrockCandidates("claude-haiku-4-5-20251001");
		const pinned = applyPinnedDefaultRegions(candidates, {
			explicitLocks: new Map([["aws-bedrock", "eu"]]),
		});
		expect(pinned).toEqual(candidates);
	});
});
