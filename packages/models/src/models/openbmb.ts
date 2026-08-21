import type { ModelDefinition } from "@/models.js";

export const openbmbModels = [
	{
		id: "minicpm-v-4.5",
		name: "MiniCPM-V 4.5",
		description:
			"OpenBMB's compact multimodal model with strong image and video understanding at an efficient 8B scale.",
		family: "openbmb",
		releasedAt: new Date("2025-08-26"),
		providers: [
			{
				providerId: "nebius",
				externalId: "openbmb/MiniCPM-V-4_5",
				inputPrice: "0.658e-6",
				outputPrice: "1.11e-6",
				requestPrice: "0",
				contextSize: 32000,
				maxOutput: undefined,
				quantization: "fp16",
				streaming: true,
				vision: true,
				tools: false,
				jsonOutput: true,
			},
		],
	},
] as const satisfies ModelDefinition[];
