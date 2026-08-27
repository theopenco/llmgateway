import type { ModelDefinition } from "@/models.js";

export const tencentModels = [
	{
		id: "hy3",
		name: "Hy3",
		description:
			"Tencent's 295B Mixture-of-Experts model with 21B active parameters, native 256K context support, and three reasoning modes for complex reasoning and agentic tasks.",
		family: "tencent",
		releasedAt: new Date("2026-07-06"),
		providers: [
			{
				providerId: "deepinfra",
				externalId: "tencent/Hy3",
				// DeepInfra's deployment is currently unreliable
				stability: "unstable",
				inputPrice: "0.14e-6",
				cachedInputPrice: "0.035e-6",
				outputPrice: "0.58e-6",
				requestPrice: "0",
				contextSize: 262144,
				maxOutput: 131072,
				quantization: "fp8",
				streaming: true,
				reasoning: true,
				reasoningEfforts: ["none", "low", "high"],
				vision: false,
				tools: true,
				jsonOutput: true,
				jsonOutputSchema: true,
			},
			{
				providerId: "novita",
				externalId: "tencent/hy3",
				inputPrice: "0.14e-6",
				cachedInputPrice: "0.035e-6",
				outputPrice: "0.58e-6",
				requestPrice: "0",
				contextSize: 262144,
				maxOutput: 262144,
				streaming: true,
				reasoning: true,
				reasoningEfforts: ["none", "low", "high"],
				vision: false,
				tools: true,
				// novita 400s on a named function choice for this deployment
				supportedToolChoices: ["auto", "none", "required"],
				jsonOutputSchema: true,
			},
		],
	},
] as const satisfies ModelDefinition[];
