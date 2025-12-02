import type { ModelDefinition } from "@/models.js";

export const zhipuModels = [
	{
		id: "glm-4-5",
		name: "GLM-4.5",
		description: "Zhipu AI's GLM-4.5 large language model.",
		family: "zhipu",
		releasedAt: new Date("2025-01-01"),
		publishedAt: new Date("2025-01-01"),
		providers: [
			{
				providerId: "nebius",
				modelName: "THUDM/GLM-4.5",
				inputPrice: 0.6 / 1e6,
				outputPrice: 2.2 / 1e6,
				requestPrice: 0,
				contextSize: 128000,
				maxOutput: undefined,
				streaming: true,
				vision: false,
				tools: true,
				jsonOutput: true,
			},
		],
	},
	{
		id: "glm-4-5-air",
		name: "GLM-4.5 Air",
		description: "Zhipu AI's lightweight GLM-4.5 Air model.",
		family: "zhipu",
		releasedAt: new Date("2025-01-01"),
		publishedAt: new Date("2025-01-01"),
		providers: [
			{
				providerId: "nebius",
				modelName: "THUDM/GLM-4.5-Air",
				inputPrice: 0.2 / 1e6,
				outputPrice: 1.2 / 1e6,
				requestPrice: 0,
				contextSize: 128000,
				maxOutput: undefined,
				streaming: true,
				vision: false,
				tools: true,
				jsonOutput: true,
			},
		],
	},
] as const satisfies ModelDefinition[];
