import type { ModelDefinition } from "@/models.js";

export const sakanaModels = [
	{
		id: "fugu-ultra",
		name: "Fugu Ultra",
		description:
			"Sakana AI's quality-optimized multi-agent orchestration model. Delivered as a single OpenAI-compatible model, Fugu Ultra coordinates a pool of frontier models — selecting, delegating, verifying, and synthesizing internally — for hard, multi-step reasoning.",
		family: "sakana",
		releasedAt: new Date("2026-06-22"),
		providers: [
			{
				providerId: "sakana" as const,
				externalId: "fugu-ultra",
				// Multi-agent orchestration is far too slow for e2e (reasoning
				// prompts exceed the test timeout); excluded from the suite
				test: "skip",
				inputPrice: "5e-6",
				outputPrice: "30e-6",
				cachedInputPrice: "0.5e-6",
				// Fugu Ultra switches to higher rates once the context exceeds 272K.
				pricingTiers: [
					{
						name: "Up to 272K",
						upToTokens: 272000,
						inputPrice: "5e-6",
						outputPrice: "30e-6",
						cachedInputPrice: "0.5e-6",
					},
					{
						name: "Over 272K",
						upToTokens: Infinity,
						inputPrice: "10e-6",
						outputPrice: "45e-6",
						cachedInputPrice: "1e-6",
					},
				],
				requestPrice: "0",
				contextSize: 1000000,
				streaming: true,
				reasoning: true,
				// Fugu reasoning summaries are only exposed via the OpenAI Responses
				// API, so route through it. Summaries are adaptive (omitted for
				// simpler prompts), hence reasoningOutput is "omit".
				supportsResponsesApi: true,
				reasoningOutput: "omit" as const,
				vision: true,
				tools: true,
				jsonOutput: true,
			},
		],
	},
] as const satisfies ModelDefinition[];
