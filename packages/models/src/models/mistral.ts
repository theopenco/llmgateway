import type { ModelDefinition } from "@llmgateway/models";

export const mistralModels = [
	{
		id: "mistral-large-latest",
		name: "Mistral Large Latest",
		family: "mistral",
		deprecatedAt: undefined,
		deactivatedAt: undefined,
		providers: [
			{
				providerId: "mistral",
				modelName: "mistral-large-latest",
				inputPrice: 0.000004,
				outputPrice: 0.000012,
				requestPrice: 0,
				contextSize: 128000,
				maxOutput: undefined,
				streaming: true,
				vision: false,
				tools: true,
			},
		],
		jsonOutput: false,
	},
	{
		id: "mistral-nemo-instruct-2407",
		name: "Mistral Nemo Instruct 2407",
		family: "mistral",
		deprecatedAt: undefined,
		deactivatedAt: undefined,
		providers: [
			{
				providerId: "nebius",
				modelName: "mistralai/Mistral-Nemo-Instruct-2407",
				inputPrice: 0.04 / 1e6,
				outputPrice: 0.12 / 1e6,
				requestPrice: 0,
				contextSize: 128000,
				maxOutput: undefined,
				streaming: true,
				vision: false,
				tools: true,
			},
		],
		jsonOutput: true,
	},
] as const satisfies ModelDefinition[];
