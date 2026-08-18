import { describe, expect, it } from "vitest";

import {
	ROUTING_EXCLUSION_REASONS,
	routingExclusionReasonMessage,
} from "@llmgateway/shared";

import {
	exclusionReason,
	getProviderFilterReasons,
	mergeFilteredProvider,
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
		).toEqual([exclusionReason("no_reasoning_variant")]);
		expect(
			getProviderFilterReasons(mapping(), { reasoningEffort: "high" }),
		).toEqual([exclusionReason("reasoning_effort")]);
		expect(
			getProviderFilterReasons(mapping(), { reasoningMaxTokens: 512 }),
		).toEqual([exclusionReason("reasoning_max_tokens")]);
	});

	it('treats reasoning_effort "none" as not requiring reasoning support', () => {
		expect(
			getProviderFilterReasons(mapping(), { reasoningEffort: "none" }),
		).toEqual([]);
	});

	it("flags unsupported tools and web search", () => {
		expect(getProviderFilterReasons(mapping(), { hasTools: true })).toEqual([
			exclusionReason("tools"),
		]);
		expect(
			getProviderFilterReasons(mapping({ tools: true }), {
				hasTools: true,
				webSearchTool: true,
			}),
		).toEqual([exclusionReason("web_search")]);
	});

	describe("search-on-demand-only mappings", () => {
		const dashScope = mapping({
			providerId: "alibaba",
			webSearch: true,
			webSearchForcedOnly: true,
		});

		it("skips them when the tool is merely offered", () => {
			// The chat-toggle case: the tool rides along on every turn with
			// tool_choice auto. These mappings cannot elect a search, so letting
			// them win the route would answer from stale weights.
			expect(
				getProviderFilterReasons(dashScope, { webSearchTool: true }),
			).toEqual([exclusionReason("web_search_forced_only")]);
		});

		it("allows them once the caller forces", () => {
			expect(
				getProviderFilterReasons(dashScope, {
					webSearchTool: true,
					webSearchForced: true,
				}),
			).toEqual([]);
		});

		it("reads intent off the tool when no separate flag is passed", () => {
			// filterEligibleModelProviders forwards the extracted tool and no
			// webSearchForced flag, so missing this would filter out the mappings
			// a forced request exists to reach.
			expect(
				getProviderFilterReasons(dashScope, {
					webSearchTool: { type: "web_search", forced: true },
				}),
			).toEqual([]);
			expect(
				getProviderFilterReasons(dashScope, {
					webSearchTool: { type: "web_search" },
				}),
			).toEqual([exclusionReason("web_search_forced_only")]);
		});

		it("leaves them alone when no web search was requested", () => {
			expect(getProviderFilterReasons(dashScope, {})).toEqual([]);
		});

		it("does not constrain providers that elect their own searches", () => {
			expect(
				getProviderFilterReasons(mapping({ webSearch: true }), {
					webSearchTool: true,
				}),
			).toEqual([]);
		});
	});

	it("flags n > 1 constraints", () => {
		expect(getProviderFilterReasons(mapping(), { n: 2 })).toEqual([
			exclusionReason("n_unsupported"),
		]);
		expect(
			getProviderFilterReasons(mapping({ supportsN: true, maxN: 2 }), { n: 4 }),
		).toEqual([exclusionReason("n_limit")]);
		expect(
			getProviderFilterReasons(
				mapping({ supportsN: true, supportsNStreaming: false }),
				{ n: 2, stream: true },
			),
		).toEqual([exclusionReason("n_streaming")]);
		expect(getProviderFilterReasons(mapping(), { n: 1 })).toEqual([]);
	});

	it("flags json output constraints", () => {
		expect(
			getProviderFilterReasons(mapping(), {
				responseFormatType: "json_object",
			}),
		).toEqual([exclusionReason("json_output")]);
		expect(
			getProviderFilterReasons(mapping({ jsonOutput: true }), {
				responseFormatType: "json_schema",
			}),
		).toEqual([exclusionReason("json_schema")]);
	});

	it("treats the two JSON tiers independently for json_schema routing", () => {
		// A provider that supports strict json_schema without json_object
		// (e.g. Runware, Perplexity, Anthropic) must not be excluded from
		// json_schema routing just because it lacks soft jsonOutput.
		expect(
			getProviderFilterReasons(
				mapping({ jsonOutputSchema: true, jsonOutput: false }),
				{ responseFormatType: "json_schema" },
			),
		).toEqual([]);
		// ...but json_object still requires soft jsonOutput.
		expect(
			getProviderFilterReasons(
				mapping({ jsonOutputSchema: true, jsonOutput: false }),
				{ responseFormatType: "json_object" },
			),
		).toEqual([exclusionReason("json_output")]);
	});

	it("flags unsupported modalities", () => {
		expect(getProviderFilterReasons(mapping(), { hasImages: true })).toEqual([
			exclusionReason("vision"),
		]);
		expect(getProviderFilterReasons(mapping(), { hasAudio: true })).toEqual([
			exclusionReason("audio"),
		]);
		expect(getProviderFilterReasons(mapping(), { hasDocuments: true })).toEqual(
			[exclusionReason("documents")],
		);
	});

	it("flags mappings that reject a trailing assistant message", () => {
		expect(
			getProviderFilterReasons(mapping({ supportsAssistantPrefill: false }), {
				hasAssistantPrefill: true,
			}),
		).toEqual([exclusionReason("assistant_prefill")]);
		expect(
			getProviderFilterReasons(mapping(), { hasAssistantPrefill: true }),
		).toEqual([]);
		expect(
			getProviderFilterReasons(
				mapping({ supportsAssistantPrefill: false }),
				{},
			),
		).toEqual([]);
	});

	it("flags max_tokens above the provider's max output", () => {
		expect(
			getProviderFilterReasons(mapping({ maxOutput: 4096 }), {
				maxTokens: 8192,
			}),
		).toEqual([exclusionReason("max_tokens")]);
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
			exclusionReason("tools"),
			exclusionReason("json_output"),
			exclusionReason("vision"),
		]);
	});
});

describe("recordFilteredProvider", () => {
	it("adds a new entry per provider id with codes and messages", () => {
		const list: FilteredProvider[] = [];
		recordFilteredProvider(list, "openai", [exclusionReason("tools")]);
		recordFilteredProvider(list, "anthropic", [exclusionReason("vision")]);
		expect(list).toEqual([
			{
				providerId: "openai",
				reasons: ["tools not supported"],
				codes: ["tools"],
			},
			{
				providerId: "anthropic",
				reasons: ["vision not supported"],
				codes: ["vision"],
			},
		]);
	});

	it("merges reasons for repeated provider ids without duplicates", () => {
		const list: FilteredProvider[] = [];
		recordFilteredProvider(list, "openai", [exclusionReason("tools")]);
		recordFilteredProvider(list, "openai", [
			exclusionReason("tools"),
			exclusionReason("vision"),
		]);
		expect(list).toEqual([
			{
				providerId: "openai",
				reasons: ["tools not supported", "vision not supported"],
				codes: ["tools", "vision"],
			},
		]);
	});

	it("keeps a caller's custom message while still recording the code", () => {
		const list: FilteredProvider[] = [];
		recordFilteredProvider(list, "azure", [
			exclusionReason("service_tier", "service tier 'flex' not supported"),
		]);
		expect(list).toEqual([
			{
				providerId: "azure",
				reasons: ["service tier 'flex' not supported"],
				codes: ["service_tier"],
			},
		]);
	});

	it("dedupes a code recorded twice under different prose", () => {
		// Two call sites can describe the same drop differently (the service-tier
		// filter varies its wording by source). Both messages are worth showing,
		// but the aggregation key must appear once.
		const list: FilteredProvider[] = [];
		recordFilteredProvider(list, "azure", [
			exclusionReason("service_tier", "service tier 'flex' not supported"),
		]);
		recordFilteredProvider(list, "azure", [
			exclusionReason(
				"service_tier",
				"service tier 'flex' (coding plan default) not supported",
			),
		]);
		expect(list[0].codes).toEqual(["service_tier"]);
		expect(list[0].reasons).toHaveLength(2);
	});

	it("keeps every exclusion code mapped to a message", () => {
		for (const code of ROUTING_EXCLUSION_REASONS) {
			expect(routingExclusionReasonMessage(code)).toBeTruthy();
		}
	});
});

describe("mergeFilteredProvider", () => {
	it("carries both prose and codes across lists", () => {
		const source: FilteredProvider[] = [];
		recordFilteredProvider(source, "azure", [exclusionReason("service_tier")]);
		const target: FilteredProvider[] = [];
		recordFilteredProvider(target, "azure", [exclusionReason("vision")]);

		mergeFilteredProvider(target, source[0]);

		expect(target).toEqual([
			{
				providerId: "azure",
				reasons: [
					"vision not supported",
					"service tier not supported by this mapping",
				],
				codes: ["vision", "service_tier"],
			},
		]);
	});

	it("adds a provider the target list has never seen", () => {
		const target: FilteredProvider[] = [];
		mergeFilteredProvider(target, {
			providerId: "aws-mantle",
			reasons: ["max_tokens exceeds provider limit"],
			codes: ["max_tokens"],
		});
		expect(target).toEqual([
			{
				providerId: "aws-mantle",
				reasons: ["max_tokens exceeds provider limit"],
				codes: ["max_tokens"],
			},
		]);
	});
});
