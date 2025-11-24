import type { ModelDefinition } from "@/models.js";

export const minimaxModels = [
	{
		id: "minimax-m2",
		name: "MiniMax M2",
		description: "MiniMax M2 model with reasoning and tool support.",
		family: "minimax",
		releasedAt: new Date("2025-06-01"),
		publishedAt: new Date("2025-06-01"),
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
