import type { ModelDefinition } from "@/models.js";

export const nebiusModels = [
	{
		id: "gpt-oss-120b",
		name: "GPT-OSS 120B",
		description: "Nebius open-source 120B parameter model.",
		family: "nebius",
		releasedAt: new Date("2025-01-01"),
		publishedAt: new Date("2025-01-01"),
		providers: [
			{
				providerId: "nebius",
				modelName: "nvidia/gpt-oss-120b",
				inputPrice: 0.15 / 1e6,
				outputPrice: 0.6 / 1e6,
				requestPrice: 0,
				contextSize: 128000,
				maxOutput: undefined,
				streaming: true,
				vision: false,
				tools: false,
				jsonOutput: false,
			},
		],
	},
	{
		id: "gpt-oss-20b",
		name: "GPT-OSS 20B",
		description: "Nebius open-source 20B parameter model.",
		family: "nebius",
		releasedAt: new Date("2025-01-01"),
		publishedAt: new Date("2025-01-01"),
		providers: [
			{
				providerId: "nebius",
				modelName: "nvidia/gpt-oss-20b",
				inputPrice: 0.05 / 1e6,
				outputPrice: 0.2 / 1e6,
				requestPrice: 0,
				contextSize: 128000,
				maxOutput: undefined,
				streaming: true,
				vision: false,
				tools: false,
				jsonOutput: false,
			},
		],
	},
] as const satisfies ModelDefinition[];
