import { describe, expect, test } from "vitest";

import { models } from "@llmgateway/models";

import { prepareRequestBody } from "./prepare-request-body.js";
import { getProviderApiTransport } from "./provider-api-format.js";
import {
	autoModeEnablesCaching,
	DEFAULT_MIN_CACHEABLE_TOKENS,
} from "./provider-cache-control.js";

import type {
	BaseMessage,
	ProviderCacheControlMode,
	ProviderModelMapping,
} from "@llmgateway/models";

function catalogueMapping(
	modelId: string,
	providerId: string,
): ProviderModelMapping {
	const mapping = models
		.find((model) => model.id === modelId)
		?.providers.find((provider) => provider.providerId === providerId) as
		ProviderModelMapping | undefined;
	if (!mapping) {
		throw new Error(`No catalogue mapping for ${providerId}/${modelId}`);
	}
	return mapping;
}

function noMarkerConversation(mapping: ProviderModelMapping): BaseMessage[] {
	const minTokens = mapping.minCacheableTokens ?? DEFAULT_MIN_CACHEABLE_TOKENS;
	return [
		{ role: "system", content: "Follow the style guide. ".repeat(minTokens) },
		{ role: "user", content: "Summarize the style guide." },
		{ role: "assistant", content: "It asks for short sentences." },
		{ role: "user", content: "Rewrite this paragraph to match." },
	];
}

async function serializedBody(
	modelId: string,
	mapping: ProviderModelMapping,
	mode: ProviderCacheControlMode,
	useResponsesApi: boolean | undefined,
): Promise<string> {
	const body = await prepareRequestBody(
		getProviderApiTransport(mapping.providerId, mapping.apiFormat),
		modelId,
		null,
		mapping.externalId,
		noMarkerConversation(mapping),
		false,
		undefined,
		1024,
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
		false,
		20,
		null,
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
		useResponsesApi,
		undefined,
		undefined,
		mode,
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
		mapping,
	);
	return JSON.stringify(body);
}

interface DriftCase {
	name: string;
	modelId: string;
	mapping: ProviderModelMapping;
	cachesOnlyInAuto: boolean;
}

const catalogueCases: Array<[string, string, boolean]> = [
	["claude-sonnet-5", "anthropic", true],
	["claude-sonnet-5", "vertex-anthropic", true],
	["claude-sonnet-5", "azure-anthropic", true],
	["claude-sonnet-5", "aws-bedrock", true],
	["kimi-k3", "aws-bedrock", false],
	["gpt-5.6-sol", "openai", true],
	["gpt-5.5", "openai", false],
	["gpt-5.6-sol", "azure", false],
	["gpt-5.6-sol", "aws-mantle", false],
	["kimi-k3", "alibaba", false],
	["gemini-3.5-flash", "google-ai-studio", false],
];

const cases: DriftCase[] = [
	...catalogueCases.map(([modelId, providerId, cachesOnlyInAuto]) => {
		const mapping = catalogueMapping(modelId, providerId);
		return {
			name: `${providerId}/${modelId} (${mapping.apiFormat ?? "provider-native"})`,
			modelId,
			mapping,
			cachesOnlyInAuto,
		};
	}),
	{
		name: "an OpenAI-format mapping of an explicit-cache model",
		modelId: "gpt-5.6-sol",
		mapping: {
			...catalogueMapping("gpt-5.6-sol", "openai"),
			providerId: "aws-bedrock",
			apiFormat: "openai-chat-completions",
		},
		cachesOnlyInAuto: true,
	},
];

describe("autoModeEnablesCaching", () => {
	test.each(cases)(
		"Automatic differs from Client-managed exactly where it says: $name",
		async ({ modelId, mapping, cachesOnlyInAuto }) => {
			expect(
				autoModeEnablesCaching({
					providerId: mapping.providerId,
					modelId,
					apiFormat: mapping.apiFormat ?? null,
				}),
				"predicate",
			).toBe(cachesOnlyInAuto);
			const responsesPaths =
				getProviderApiTransport(mapping.providerId, mapping.apiFormat) ===
				"openai"
					? [false, true]
					: [undefined];
			for (const useResponsesApi of responsesPaths) {
				const auto = await serializedBody(
					modelId,
					mapping,
					"auto",
					useResponsesApi,
				);
				const passthrough = await serializedBody(
					modelId,
					mapping,
					"passthrough",
					useResponsesApi,
				);
				expect(
					auto !== passthrough,
					`prepareRequestBody bodies differ (useResponsesApi=${String(useResponsesApi)})`,
				).toBe(cachesOnlyInAuto);
			}
		},
	);
});
