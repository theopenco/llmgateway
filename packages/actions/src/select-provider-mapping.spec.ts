import { describe, expect, it } from "vitest";

import { selectProviderMapping } from "./select-provider-mapping.js";

import type { ProviderModelMapping } from "@llmgateway/models";

describe("selectProviderMapping", () => {
	it("falls back to the region-agnostic mapping when only the root entry exists (unpinned AWS Bedrock regression)", () => {
		// Unpinned routing leaves modelInfo.providers un-expanded: only the
		// synthetic root mapping (region: undefined) survives, but the gateway
		// resolves usedRegion to a concrete "global". Before the fix the exact
		// lookup returned undefined -> supportsReasoning became false -> Bedrock
		// Claude returned no reasoning.
		const providers: ProviderModelMapping[] = [
			{
				providerId: "aws-bedrock",
				externalId: "anthropic.claude-opus-4-6-v1",
				streaming: true,
				region: undefined,
				reasoning: true,
			},
		];

		const mapping = selectProviderMapping(providers, "aws-bedrock", "global");

		expect(mapping).toBeDefined();
		expect(mapping?.reasoning).toBe(true);
	});

	it("prefers the exact region match when an expanded entry is present", () => {
		const providers: ProviderModelMapping[] = [
			{
				providerId: "aws-bedrock",
				externalId: "anthropic.claude-opus-4-6-v1",
				streaming: true,
				region: undefined,
				reasoning: true,
			},
			{
				providerId: "aws-bedrock",
				externalId: "anthropic.claude-opus-4-6-v1",
				streaming: true,
				region: "global",
				reasoning: true,
				maxOutput: 128000,
			},
		];

		const mapping = selectProviderMapping(providers, "aws-bedrock", "global");

		expect(mapping?.region).toBe("global");
		expect(mapping?.maxOutput).toBe(128000);
	});

	it("prefers the region-agnostic root over a concrete-region entry when the exact region misses (order-independent)", () => {
		// A concrete-region entry is listed before the root, and usedRegion matches
		// neither. The fallback must still resolve to the region-agnostic root
		// mapping rather than the first array element.
		const providers: ProviderModelMapping[] = [
			{
				providerId: "aws-bedrock",
				externalId: "anthropic.claude-opus-4-6-v1",
				streaming: true,
				region: "us",
				reasoning: true,
			},
			{
				providerId: "aws-bedrock",
				externalId: "anthropic.claude-opus-4-6-v1",
				streaming: true,
				region: undefined,
				reasoning: true,
			},
		];

		const mapping = selectProviderMapping(providers, "aws-bedrock", "global");

		expect(mapping?.region).toBeUndefined();
	});

	it("returns undefined when no mapping matches the provider", () => {
		const providers: ProviderModelMapping[] = [
			{
				providerId: "openai",
				externalId: "gpt-5",
				streaming: true,
				region: undefined,
			},
		];

		expect(
			selectProviderMapping(providers, "aws-bedrock", "global"),
		).toBeUndefined();
	});

	it("matches a region-less mapping when usedRegion is undefined", () => {
		const providers: ProviderModelMapping[] = [
			{
				providerId: "anthropic",
				externalId: "claude-opus-4-6",
				streaming: true,
				region: undefined,
				reasoning: true,
			},
		];

		const mapping = selectProviderMapping(providers, "anthropic", undefined);

		expect(mapping?.reasoning).toBe(true);
	});
});
