import { describe, expect, it } from "vitest";

import {
	getProviderFilterReasons,
	recordFilteredProvider,
	type FilteredProvider,
} from "./provider-filter-reasons.js";

import type { ProviderModelMapping } from "@llmgateway/models";

function mapping(overrides: Partial<ProviderModelMapping> = {}) {
	return {
		providerId: "openai",
		externalId: "test-model",
		...overrides,
	} as ProviderModelMapping;
}

describe("getProviderFilterReasons", () => {
	it("returns no reasons when nothing is requested", () => {
		expect(getProviderFilterReasons(mapping(), {})).toEqual([]);
	});

	it("returns no reasons when the provider supports everything requested", () => {
		const provider = mapping({
			reasoning: true,
			reasoningMaxTokens: true,
			tools: true,
			webSearch: true,
			jsonOutput: true,
			jsonOutputSchema: true,
			vision: true,
			audio: true,
			document: true,
			maxOutput: 10000,
			supportsN: true,
		});
		expect(
			getProviderFilterReasons(provider, {
				webSearchTool: true,
				responseFormatType: "json_schema",
				hasImages: true,
				hasAudio: true,
				hasDocuments: true,
				hasTools: true,
				reasoningEffort: "high",
				reasoningMaxTokens: 1024,
				maxTokens: 5000,
				n: 2,
				stream: true,
			}),
		).toEqual([]);
	});

	it("flags reasoning constraints", () => {
		expect(
			getProviderFilterReasons(mapping({ reasoning: true }), {
				noReasoning: true,
			}),
		).toEqual(["no_reasoning requested but provider has reasoning"]);
		expect(
			getProviderFilterReasons(mapping(), { reasoningEffort: "high" }),
		).toEqual(["reasoning_effort not supported"]);
		expect(
			getProviderFilterReasons(mapping(), { reasoningMaxTokens: 512 }),
		).toEqual(["reasoning_max_tokens not supported"]);
	});

	it('treats reasoning_effort "none" as not requiring reasoning support', () => {
		expect(
			getProviderFilterReasons(mapping(), { reasoningEffort: "none" }),
		).toEqual([]);
	});

	it("flags unsupported tools and web search", () => {
		expect(getProviderFilterReasons(mapping(), { hasTools: true })).toEqual([
			"tools not supported",
		]);
		expect(
			getProviderFilterReasons(mapping({ tools: true }), {
				hasTools: true,
				webSearchTool: true,
			}),
		).toEqual(["web_search not supported"]);
	});

	it("flags n > 1 constraints", () => {
		expect(getProviderFilterReasons(mapping(), { n: 2 })).toEqual([
			"n > 1 not supported",
		]);
		expect(
			getProviderFilterReasons(mapping({ supportsN: true, maxN: 2 }), { n: 4 }),
		).toEqual(["n exceeds provider limit"]);
		expect(
			getProviderFilterReasons(
				mapping({ supportsN: true, supportsNStreaming: false }),
				{ n: 2, stream: true },
			),
		).toEqual(["n > 1 not supported when streaming"]);
		expect(getProviderFilterReasons(mapping(), { n: 1 })).toEqual([]);
	});

	it("flags json output constraints", () => {
		expect(
			getProviderFilterReasons(mapping(), {
				responseFormatType: "json_object",
			}),
		).toEqual(["json_output not supported"]);
		expect(
			getProviderFilterReasons(mapping({ jsonOutput: true }), {
				responseFormatType: "json_schema",
			}),
		).toEqual(["json_schema not supported"]);
	});

	it("flags unsupported modalities", () => {
		expect(getProviderFilterReasons(mapping(), { hasImages: true })).toEqual([
			"vision not supported",
		]);
		expect(getProviderFilterReasons(mapping(), { hasAudio: true })).toEqual([
			"audio not supported",
		]);
		expect(getProviderFilterReasons(mapping(), { hasDocuments: true })).toEqual(
			["documents not supported"],
		);
	});

	it("flags max_tokens above the provider's max output", () => {
		expect(
			getProviderFilterReasons(mapping({ maxOutput: 4096 }), {
				maxTokens: 8192,
			}),
		).toEqual(["max_tokens exceeds provider limit"]);
		expect(
			getProviderFilterReasons(mapping({ maxOutput: 4096 }), {
				maxTokens: 1024,
			}),
		).toEqual([]);
		expect(getProviderFilterReasons(mapping(), { maxTokens: 8192 })).toEqual(
			[],
		);
	});

	it("collects multiple reasons at once", () => {
		expect(
			getProviderFilterReasons(mapping(), {
				hasTools: true,
				hasImages: true,
				responseFormatType: "json_object",
			}),
		).toEqual([
			"tools not supported",
			"json_output not supported",
			"vision not supported",
		]);
	});
});

describe("recordFilteredProvider", () => {
	it("adds a new entry per provider id", () => {
		const list: FilteredProvider[] = [];
		recordFilteredProvider(list, "openai", ["tools not supported"]);
		recordFilteredProvider(list, "anthropic", ["vision not supported"]);
		expect(list).toEqual([
			{ providerId: "openai", reasons: ["tools not supported"] },
			{ providerId: "anthropic", reasons: ["vision not supported"] },
		]);
	});

	it("merges reasons for repeated provider ids without duplicates", () => {
		const list: FilteredProvider[] = [];
		recordFilteredProvider(list, "openai", ["tools not supported"]);
		recordFilteredProvider(list, "openai", [
			"tools not supported",
			"vision not supported",
		]);
		expect(list).toEqual([
			{
				providerId: "openai",
				reasons: ["tools not supported", "vision not supported"],
			},
		]);
	});

	it("copies the reasons array instead of aliasing it", () => {
		const reasons = ["tools not supported"];
		const list: FilteredProvider[] = [];
		recordFilteredProvider(list, "openai", reasons);
		reasons.push("mutated");
		expect(list[0].reasons).toEqual(["tools not supported"]);
	});
});
