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
				inputPrice: 0.57,
				outputPrice: 2.3,
				requestPrice: 0,
				contextSize: 131072,
				maxOutput: 131072,
				streaming: true,
				vision: false,
			},
			{
				providerId: "moonshot",
				modelName: "kimi-k2-0711-preview",
				inputPrice: 0.6,
				outputPrice: 2.5,
				cachedInputPrice: 0.15,
				requestPrice: 0,
				contextSize: 128000,
				maxOutput: 128000,
				streaming: true,
				vision: false,
			},
		],
		jsonOutput: true,
	},
] as const satisfies ModelDefinition[];
