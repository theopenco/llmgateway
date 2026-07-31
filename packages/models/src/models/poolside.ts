import type { ModelDefinition } from "@/models.js";

export const poolsideModels = [
	{
		id: "laguna-s-2.1",
		name: "Laguna S 2.1",
		description:
			"Poolside's 118B Mixture-of-Experts model with 8B active parameters, 1M token context, and native reasoning with thinking on or off per request for long-horizon agentic coding.",
		family: "poolside",
		releasedAt: new Date("2026-07-21"),
		providers: [
			{
				providerId: "poolside",
				externalId: "poolside/laguna-s-2.1",
				inputPrice: "0.09e-6",
				cachedInputPrice: "0.009e-6",
				outputPrice: "0.18e-6",
				requestPrice: "0",
				contextSize: 1048576,
				maxOutput: 131072,
				quantization: "fp4",
				streaming: true,
				reasoning: true,
				// Thinking on the Poolside Platform defaults to max and this release
				// supports only off/max (low/medium/high are not available).
				reasoningEfforts: ["none", "max"],
				splitTaggedReasoning: true,
				vision: false,
				tools: true,
				jsonOutput: true,
			},
		],
	},
	{
		id: "laguna-xs-2.1",
		name: "Laguna XS 2.1",
		description:
			"Poolside's fast 33B Mixture-of-Experts model with 3B active parameters, 256K token context, and per-request thinking for rapid agentic coding.",
		family: "poolside",
		releasedAt: new Date("2026-07-02"),
		providers: [
			{
				providerId: "poolside",
				externalId: "poolside/laguna-xs-2.1",
				inputPrice: "0.06e-6",
				cachedInputPrice: "0.03e-6",
				outputPrice: "0.12e-6",
				requestPrice: "0",
				contextSize: 262144,
				maxOutput: 32768,
				quantization: "fp8",
				streaming: true,
				reasoning: true,
				// XS 2.1 ships the same two thinking settings as S 2.1 in this release.
				reasoningEfforts: ["none", "max"],
				splitTaggedReasoning: true,
				vision: false,
				tools: true,
				jsonOutput: true,
			},
		],
	},
] as const satisfies ModelDefinition[];
