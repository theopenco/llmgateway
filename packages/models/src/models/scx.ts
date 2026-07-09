import type { ModelDefinition } from "@/models.js";

export const scxModels = [
	{
		id: "coder",
		name: "SCX Coder",
		description:
			"High performance coding assistant from SCX.ai with reasoning, optimized for algorithms, debugging, and code review.",
		family: "scx",
		// TODO: placeholder release date pending confirmation from SCX
		releasedAt: new Date("2026-03-01"),
		providers: [
			{
				providerId: "scx-ai",
				externalId: "coder",
				inputPrice: "0.85e-6",
				outputPrice: "3.75e-6",
				requestPrice: "0",
				contextSize: 200000,
				maxOutput: 131072,
				streaming: true,
				reasoning: true,
				vision: false,
				tools: true,
				jsonOutput: true,
			},
		],
	},
] as const satisfies ModelDefinition[];
