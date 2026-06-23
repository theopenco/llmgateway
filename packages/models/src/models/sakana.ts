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
				inputPrice: "5e-6",
				outputPrice: "30e-6",
				cachedInputPrice: "0.5e-6",
				requestPrice: "0",
				contextSize: 272000,
				streaming: true,
				reasoning: true,
				reasoningOutput: "omit" as const,
				vision: true,
				tools: true,
				jsonOutput: true,
			},
		],
	},
] as const satisfies ModelDefinition[];
