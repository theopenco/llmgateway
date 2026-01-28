import type { ModelDefinition } from "@/models.js";

export const nousresearchModels = [
	{
		id: "hermes-3-llama-405b",
		name: "Hermes 3 Llama 405B",
		description: "Nous Research Hermes 3 based on Llama 405B.",
		family: "nousresearch",
		releasedAt: new Date("2024-08-16"),
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
	{
		id: "hermes-2-pro-llama-3-8b",
		name: "Hermes 2 Pro Llama 3 8B",
		description: "Nous Research Hermes 2 Pro based on Llama 3 8B.",
		family: "nousresearch",
		releasedAt: new Date("2024-05-27"),
		providers: [
			{
				providerId: "novita",
				stability: "unstable",
				modelName: "nousresearch/hermes-2-pro-llama-3-8b",
				inputPrice: 0.14 / 1e6,
				outputPrice: 0.14 / 1e6,
				requestPrice: 0,
				contextSize: 8192,
				maxOutput: 8192,
				streaming: true,
				vision: false,
				tools: false,
				jsonOutput: false,
			},
		],
	},
] as const satisfies ModelDefinition[];
