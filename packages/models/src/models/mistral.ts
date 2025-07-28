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
] as const satisfies ModelDefinition[];
