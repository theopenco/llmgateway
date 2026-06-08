import type { ModelDefinition } from "@/models.js";

export const nvidiaModels = [
	{
		id: "nemotron-3-ultra-550b",
		name: "Nemotron 3 Ultra 550B",
		description:
			"NVIDIA's most capable model with 550B parameters for complex reasoning, coding, and multimodal tasks.",
		family: "nvidia",
		releasedAt: new Date("2026-06-01"),
		providers: [
			{
				providerId: "deepinfra",
				externalId: "nvidia/NVIDIA-Nemotron-3-Ultra-550B-A55B",
				inputPrice: "0.5e-6",
				outputPrice: "2.5e-6",
				cachedInputPrice: "0.15e-6",
				requestPrice: "0",
				contextSize: 262144,
				maxOutput: undefined,
				streaming: true,
				vision: true,
				tools: true,
				jsonOutput: true,
				healStreamingJsonOutput: true,
			},
		],
	},
] as const satisfies ModelDefinition[];
