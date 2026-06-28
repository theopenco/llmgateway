import type { ModelDefinition } from "@/models.js";

export const reveModels = [
	{
		id: "reve-create",
		name: "Reve Create",
		description:
			"Reve's image generation model with native 4K resolution and code-based controllable image creation. Generates high-quality images from text prompts.",
		family: "reve",
		output: ["image"],
		releasedAt: new Date("2026-06-03"),
		providers: [
			{
				test: "skip",
				providerId: "reve",
				externalId: "reve-create@latest",
				inputPrice: "0",
				outputPrice: "0",
				requestPrice: "0.024",
				contextSize: 2560,
				maxOutput: undefined,
				streaming: false,
				vision: false,
				tools: false,
				jsonOutput: false,
				imageGenerations: true,
			},
		],
	},
] as const satisfies ModelDefinition[];
