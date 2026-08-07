import { describe, expect, it } from "vitest";

import {
	ROUTING_EXCLUSION_REASONS,
	routingExclusionReasonMessage,
} from "@llmgateway/shared";

import {
	getProviderFilterReasons,
	recordFilteredProvider,
	type FilteredProvider,
} from "./provider-filter-reasons.js";

import type { ProviderModelMapping } from "@llmgateway/models";
import type { RoutingExclusionReason } from "@llmgateway/shared";

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
		).toEqual(["no_reasoning_variant"]);
		expect(
			getProviderFilterReasons(mapping(), { reasoningEffort: "high" }),
		).toEqual(["reasoning_effort"]);
		expect(
			getProviderFilterReasons(mapping(), { reasoningMaxTokens: 512 }),
		).toEqual(["reasoning_max_tokens"]);
	});

	it('treats reasoning_effort "none" as not requiring reasoning support', () => {
		expect(
			getProviderFilterReasons(mapping(), { reasoningEffort: "none" }),
		).toEqual([]);
	});

	it("flags unsupported tools and web search", () => {
		expect(getProviderFilterReasons(mapping(), { hasTools: true })).toEqual([
			"tools",
		]);
		expect(
			getProviderFilterReasons(mapping({ tools: true }), {
				hasTools: true,
				webSearchTool: true,
			}),
		).toEqual(["web_search"]);
	});

	it("flags n > 1 constraints", () => {
		expect(getProviderFilterReasons(mapping(), { n: 2 })).toEqual([
			"n_unsupported",
		]);
		expect(
			getProviderFilterReasons(mapping({ supportsN: true, maxN: 2 }), { n: 4 }),
		).toEqual(["n_limit"]);
		expect(
			getProviderFilterReasons(
				mapping({ supportsN: true, supportsNStreaming: false }),
				{ n: 2, stream: true },
			),
		).toEqual(["n_streaming"]);
		expect(getProviderFilterReasons(mapping(), { n: 1 })).toEqual([]);
	});

	it("flags json output constraints", () => {
		expect(
			getProviderFilterReasons(mapping(), {
				responseFormatType: "json_object",
			}),
		).toEqual(["json_output"]);
		expect(
			getProviderFilterReasons(mapping({ jsonOutput: true }), {
				responseFormatType: "json_schema",
			}),
		).toEqual(["json_schema"]);
	});

	it("flags unsupported modalities", () => {
		expect(getProviderFilterReasons(mapping(), { hasImages: true })).toEqual([
			"vision",
		]);
		expect(getProviderFilterReasons(mapping(), { hasAudio: true })).toEqual([
			"audio",
		]);
		expect(getProviderFilterReasons(mapping(), { hasDocuments: true })).toEqual(
			["documents"],
		);
	});

	it("flags mappings that reject a trailing assistant message", () => {
		expect(
			getProviderFilterReasons(mapping({ supportsAssistantPrefill: false }), {
				hasAssistantPrefill: true,
			}),
		).toEqual(["assistant_prefill"]);
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
		).toEqual(["max_tokens"]);
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
		).toEqual(["tools", "json_output", "vision"]);
	});
});

describe("recordFilteredProvider", () => {
	it("adds a new entry per provider id with codes and messages", () => {
		const list: FilteredProvider[] = [];
		recordFilteredProvider(list, "openai", ["tools"]);
		recordFilteredProvider(list, "anthropic", ["vision"]);
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
		recordFilteredProvider(list, "openai", ["tools"]);
		recordFilteredProvider(list, "openai", ["tools", "vision"]);
		expect(list).toEqual([
			{
				providerId: "openai",
				reasons: ["tools not supported", "vision not supported"],
				codes: ["tools", "vision"],
			},
		]);
	});

	it("copies the codes array instead of aliasing it", () => {
		const codes: RoutingExclusionReason[] = ["tools"];
		const list: FilteredProvider[] = [];
		recordFilteredProvider(list, "openai", codes);
		codes.push("vision");
		expect(list[0].codes).toEqual(["tools"]);
		expect(list[0].reasons).toEqual(["tools not supported"]);
	});

	it("keeps every exclusion code mapped to a message", () => {
		for (const code of ROUTING_EXCLUSION_REASONS) {
			expect(routingExclusionReasonMessage(code)).toBeTruthy();
		}
	});
});
