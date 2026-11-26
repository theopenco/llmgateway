import type { ModelDefinition } from "@/models.js";

export const reflectionModels = [
	{
		id: "beam-1.0-501b-a23b",
		name: "Beam 1.0 501B A23B",
		description:
			"Reflection's open-weight reasoning MoE model (501B total, 23B active) for coding and long-horizon agentic workflows, with a 1M-token context window.",
		family: "reflection",
		releasedAt: new Date("2026-10-16"),
		providers: [
			{
				providerId: "together-ai",
				externalId: "reflection/Beam-1.0-501B-A23B",
				inputPrice: "0.4e-6",
				cachedInputPrice: "0.04e-6",
				outputPrice: "1.2e-6",
				requestPrice: "0",
				contextSize: 1048576,
				maxOutput: 131072,
				quantization: "fp4",
				streaming: true,
				reasoning: true,
				reasoningEfforts: ["low", "medium", "high"],
				vision: false,
				tools: true,
				jsonOutput: true,
				jsonOutputSchema: true,
			},
		],
	},
] as const satisfies ModelDefinition[];
