import type { ModelDefinition } from "@llmgateway/models";

export const moonshotModels = [
	{
		model: "kimi-k2",
		deprecatedAt: undefined,
		deactivatedAt: undefined,
		providers: [
			{
				providerId: "novita",
				modelName: "moonshotai/kimi-k2-instruct",
				inputPrice: 0.57 / 1e6,
				outputPrice: 2.3 / 1e6,
				requestPrice: 0,
				contextSize: 131072,
				maxOutput: 131072,
				streaming: true,
				vision: false,
			},
			{
				providerId: "moonshot",
				modelName: "kimi-k2-0711-preview",
				inputPrice: 0.6 / 1e6,
				outputPrice: 2.5 / 1e6,
				cachedInputPrice: 0.15 / 1e6,
				requestPrice: 0,
				contextSize: 128000,
				maxOutput: 128000,
				streaming: true,
				vision: false,
			},
			{
				providerId: "cloudrift",
				modelName: "moonshotai/Kimi-K2-Instruct",
				inputPrice: 0.3 / 1e6,
				outputPrice: 1.75 / 1e6,
				requestPrice: 0,
				contextSize: 131072,
				maxOutput: 131072,
				streaming: true,
				vision: false,
			},
		],
		jsonOutput: true,
	},
] as const satisfies ModelDefinition[];
