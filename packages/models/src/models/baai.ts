import type { ModelDefinition } from "@/models.js";

export const baaiModels = [
	{
		id: "bge-m3",
		name: "BGE-M3",
		description:
			"BAAI's multilingual embedding model supporting dense, sparse, and multi-vector retrieval across 100+ languages. 8K context, 1024-dim output. MIT license.",
		family: "baai",
		output: ["embedding"],
		releasedAt: new Date("2024-01-29"),
		providers: [
			{
				providerId: "deepinfra",
				externalId: "BAAI/bge-m3",
				inputPrice: "0.01e-6",
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
