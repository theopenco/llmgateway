import type { ModelDefinition } from "@/models.js";

export const minimaxModels = [
	{
		id: "minimax-m2",
		name: "MiniMax M2",
		family: "minimax",
		providers: [
			{
				providerId: "canopywave",
				modelName: "minimax/minimax-m2",
				inputPrice: 0.25 / 1e6,
				outputPrice: 1.0 / 1e6,
				discount: 0.75,
				requestPrice: 0,
				contextSize: 196608,
				maxOutput: undefined,
				streaming: true,
				reasoning: true,
				vision: false,
				tools: true,
				jsonOutput: true,
			},
		],
	},
] as const satisfies ModelDefinition[];
