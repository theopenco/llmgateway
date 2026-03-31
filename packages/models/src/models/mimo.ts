import type { ModelDefinition } from "@/models.js";

export const mimoModels = [
	{
		id: "mimo-v2-flash",
		name: "Mimo V2 Flash",
		description:
			"Mimo V2 Flash is a 309B MoE reasoning model optimized for high-speed inference and agentic workflows.",
		family: "mimo",
		providers: [
			{
				providerId: "canopywave",
				modelName: "xiaomimimo/mimo-v2-flash",
				inputPrice: 0.08 / 1e6,
				cachedInputPrice: 0.04 / 1e6,
				outputPrice: 0.24 / 1e6,
				requestPrice: 0,
				contextSize: 256000,
				maxOutput: undefined,
				streaming: true,
				vision: false,
				tools: false,
				jsonOutput: false,
			},
		],
	},
] as const satisfies ModelDefinition[];
