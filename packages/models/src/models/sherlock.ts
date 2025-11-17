import type { ModelDefinition } from "@/models.js";

export const sherlockModels = [
	{
		id: "sherlock-dash-alpha",
		name: "Sherlock Dash Alpha",
		family: "sherlock",
		free: true,
		providers: [
			{
				providerId: "sherlock",
				modelName: "sherlock-dash-alpha",
				inputPrice: 0,
				outputPrice: 0,
				requestPrice: 0,
				contextSize: 1840000,
				maxOutput: 64000,
				streaming: true,
				vision: true,
				tools: true,
				jsonOutput: true,
				reasoning: true,
			},
		],
	},
	{
		id: "sherlock-think-alpha",
		name: "Sherlock Think Alpha",
		family: "sherlock",
		free: true,
		providers: [
			{
				providerId: "sherlock",
				modelName: "sherlock-think-alpha",
				inputPrice: 0,
				outputPrice: 0,
				requestPrice: 0,
				contextSize: 1840000,
				maxOutput: 64000,
				streaming: true,
				vision: true,
				tools: true,
				jsonOutput: true,
				reasoning: true,
			},
		],
	},
] as const satisfies ModelDefinition[];
