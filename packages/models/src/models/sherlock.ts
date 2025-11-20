import type { ModelDefinition } from "@/models.js";

export const sherlockModels = [
	{
		id: "sherlock-dash-alpha",
		name: "Sherlock Dash Alpha",
		description: "Revealed to be Grok 4.1",
		family: "sherlock",
		free: true,
		rateLimitKind: "high",
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
				deactivatedAt: new Date("2025-11-18"),
			},
		],
	},
	{
		id: "sherlock-think-alpha",
		name: "Sherlock Think Alpha",
		description: "Revealed to be Grok 4.1",
		family: "sherlock",
		free: true,
		rateLimitKind: "high",
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
				deactivatedAt: new Date("2025-11-18"),
			},
		],
	},
] as const satisfies ModelDefinition[];
