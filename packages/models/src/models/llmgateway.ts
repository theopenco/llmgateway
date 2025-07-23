import type { ModelDefinition } from "@llmgateway/models";

export const llmgatewayModels = [
	{
		id: "custom", // custom provider which expects base URL to be set
		name: "Custom Model",
		family: "llmgateway",
		deprecatedAt: undefined,
		deactivatedAt: undefined,
		providers: [
			{
				providerId: "llmgateway",
				modelName: "custom",
				inputPrice: undefined,
				outputPrice: undefined,
				requestPrice: undefined,
				contextSize: undefined,
				streaming: true,
				vision: false,
			},
		],
	},
	{
		id: "auto", // native automatic routing
		name: "Auto Route",
		family: "llmgateway",
		deprecatedAt: undefined,
		deactivatedAt: undefined,
		providers: [
			{
				providerId: "llmgateway",
				modelName: "auto",
				inputPrice: undefined,
				outputPrice: undefined,
				requestPrice: undefined,
				contextSize: undefined,
				streaming: true,
				vision: false,
			},
		],
	},
] as const satisfies ModelDefinition[];
