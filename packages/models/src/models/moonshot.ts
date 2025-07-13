import type { ModelDefinition } from "@llmgateway/models";

export const moonshotModels = [
	{
		model: "kimi-k2-instruct",
		deprecatedAt: undefined,
		deactivatedAt: undefined,
		providers: [
			{
				providerId: "novita",
				modelName: "moonshotai/kimi-k2-instruct",
				inputPrice: 0.6,
				outputPrice: 2.5,
				cachedInputPrice: 0.15,
				requestPrice: 0,
				contextSize: 32768,
				maxOutput: 4096,
				streaming: true,
				vision: false,
			},
		],
		jsonOutput: true,
	},
] as const satisfies ModelDefinition[];
