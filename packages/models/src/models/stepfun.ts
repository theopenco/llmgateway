import type { ModelDefinition } from "@/models.js";

export const stepfunModels = [
	{
		id: "step-3.7-flash",
		name: "Step 3.7 Flash",
		description:
			"StepFun's high-efficiency multimodal MoE model (196B language backbone, ~11B active) with native image and video understanding.",
		family: "stepfun",
		releasedAt: new Date("2026-05-28"),
		providers: [
			{
				providerId: "novita",
				externalId: "stepfun/step-3.7-flash",
				inputPrice: "0.2e-6",
				cachedInputPrice: "0.04e-6",
				outputPrice: "1.15e-6",
				requestPrice: "0",
				contextSize: 262144,
				maxOutput: 256000,
				quantization: "fp8",
				maxTemperature: 1,
				streaming: true,
				reasoning: true,
				vision: true,
				tools: true,
				supportedToolChoices: ["auto", "required", "function"],
				jsonOutput: false,
			},
			{
				providerId: "deepinfra",
				externalId: "stepfun-ai/Step-3.7-Flash",
				// DeepInfra retires this model on 2026-10-01 and silently
				// redirects requests to XiaomiMiMo/MiMo-V2.6-Flash afterwards.
				deactivatedAt: new Date("2026-10-01"),
				inputPrice: "0.2e-6",
				cachedInputPrice: "0.04e-6",
				outputPrice: "1.15e-6",
				requestPrice: "0",
				contextSize: 262144,
				maxOutput: 32768,
				maxTemperature: 1,
				streaming: true,
				reasoning: true,
				reasoningEfforts: ["minimal", "low", "medium", "high", "xhigh", "max"],
				vision: true,
				tools: true,
				supportedToolChoices: ["auto", "none", "function"],
				jsonOutput: false,
			},
		],
	},
] as const satisfies ModelDefinition[];
