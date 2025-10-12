import type { ModelDefinition } from "@/models.js";

export const azureModels = [
	{
		id: "gpt-4o-mini",
		family: "openai",
		providers: [
			{
				providerId: "azure",
				modelName: "gpt-4o-mini",
				inputPrice: 0.15 / 1e6,
				outputPrice: 0.6 / 1e6,
				contextSize: 128000,
				maxOutput: 16384,
				streaming: true,
				vision: false,
				tools: true,
			},
		],
	},
	{
		id: "gpt-4o",
		family: "openai",
		providers: [
			{
				providerId: "azure",
				modelName: "gpt-4o",
				inputPrice: 2.5 / 1e6,
				outputPrice: 10.0 / 1e6,
				imageInputPrice: 0.00553,
				contextSize: 128000,
				maxOutput: 16384,
				streaming: true,
				vision: true,
				tools: true,
			},
		],
	},
	{
		id: "gpt-4",
		family: "openai",
		providers: [
			{
				providerId: "azure",
				modelName: "gpt-4",
				inputPrice: 30.0 / 1e6,
				outputPrice: 60.0 / 1e6,
				contextSize: 8192,
				maxOutput: 8192,
				streaming: true,
				vision: false,
				tools: true,
			},
		],
	},
	{
		id: "gpt-4-turbo",
		family: "openai",
		providers: [
			{
				providerId: "azure",
				modelName: "gpt-4-turbo",
				inputPrice: 10.0 / 1e6,
				outputPrice: 30.0 / 1e6,
				contextSize: 128000,
				maxOutput: 4096,
				streaming: true,
				vision: true,
				tools: true,
			},
		],
	},
	{
		id: "gpt-3.5-turbo",
		family: "openai",
		providers: [
			{
				providerId: "azure",
				modelName: "gpt-35-turbo",
				inputPrice: 0.5 / 1e6,
				outputPrice: 1.5 / 1e6,
				contextSize: 16385,
				maxOutput: 4096,
				streaming: true,
				vision: false,
				tools: true,
			},
		],
	},
] as const satisfies ModelDefinition[];
