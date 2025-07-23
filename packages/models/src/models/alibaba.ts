import type { ModelDefinition } from "@llmgateway/models";

export const alibabaModels = [
	{
		model: "qwen-plus",
		deprecatedAt: undefined,
		deactivatedAt: undefined,
		providers: [
			{
				providerId: "alibaba",
				modelName: "qwen-plus",
				inputPrice: 0.4 / 1e6,
				outputPrice: 4.0 / 1e6,
				requestPrice: 0,
				contextSize: 32768,
				maxOutput: 8192,
				streaming: true,
				vision: false,
			},
		],
		jsonOutput: true,
	},
	{
		model: "qwen-turbo",
		deprecatedAt: undefined,
		deactivatedAt: undefined,
		providers: [
			{
				providerId: "alibaba",
				modelName: "qwen-turbo",
				inputPrice: 0.05 / 1e6,
				outputPrice: 0.2 / 1e6,
				requestPrice: 0,
				contextSize: 1000000,
				maxOutput: 8192,
				streaming: true,
				vision: false,
			},
		],
		jsonOutput: true,
	},
	{
		model: "qwen3-coder-plus",
		deprecatedAt: undefined,
		deactivatedAt: undefined,
		providers: [
			{
				providerId: "alibaba",
				modelName: "qwen3-coder-plus",
				inputPrice: 6 / 1e6,
				outputPrice: 60 / 1e6,
				requestPrice: 0,
				contextSize: 1000000,
				maxOutput: 66000,
				streaming: true,
				vision: false,
			},
		],
		jsonOutput: true,
	},
] as const satisfies ModelDefinition[];
