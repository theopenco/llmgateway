import type { ModelDefinition } from "@/models.js";

export const deapiModels = [
	{
		id: "bge-m3",
		name: "BGE-M3",
		description:
			"Multilingual BGE-M3 embedding model from BAAI (1024-dimensional output, 8192-token context). Served through deAPI's OpenAI-compatible /v1/embeddings endpoint.",
		family: "deapi",
		output: ["embedding"],
		releasedAt: new Date("2024-01-30"),
		providers: [
			{
				providerId: "deapi",
				externalId: "Bge_M3_FP16",
				inputPrice: "0.13e-6",
				outputPrice: "0",
				requestPrice: "0",
				contextSize: 8192,
				streaming: false,
				tools: false,
				jsonOutput: false,
				embeddings: true,
			},
		],
	},
] as const satisfies ModelDefinition[];
