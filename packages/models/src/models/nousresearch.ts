import type { ModelDefinition } from "@/models.js";

export const nousresearchModels = [
	{
		id: "hermes-3-llama-405b",
		name: "Hermes 3 Llama 405B",
		family: "nousresearch",
		providers: [
			{
				providerId: "nebius",
				modelName: "NousResearch/Hermes-3-Llama-405B",
				inputPrice: 1.0 / 1e6,
				outputPrice: 3.0 / 1e6,
				requestPrice: 0,
				contextSize: 131072,
				maxOutput: undefined,
				streaming: true,
				vision: false,
				tools: false,
				jsonOutput: true,
				deactivatedAt: new Date("2025-11-03"),
			},
		],
	},
] as const satisfies ModelDefinition[];
