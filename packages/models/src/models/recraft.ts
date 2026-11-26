import type { ModelDefinition } from "@/models.js";

export const recraftModels = [
	{
		id: "recraft-v4.1-flash",
		name: "Recraft V4.1 Flash",
		description:
			"Recraft's fast V4.1 raster image model for photography, illustration, and mixed-media compositions.",
		family: "recraft",
		output: ["image"],
		releasedAt: new Date("2026-09-20"),
		providers: [
			{
				test: "skip",
				providerId: "fal-ai",
				externalId: "recraft/v4.1/flash/text-to-image",
				inputPrice: "0",
				outputPrice: "0",
				requestPrice: "0",
				perImagePrice: {
					default: "0.007",
				},
				streaming: false,
				vision: false,
				tools: false,
				jsonOutput: false,
				imageGenerations: true,
			},
		],
	},
] as const satisfies ModelDefinition[];
