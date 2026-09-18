import type { ModelDefinition } from "@/models.js";

export const kinfraModels = [
	{
		id: "kinfra-text-embedding-0.6b",
		name: "Kinfra Text Embedding 0.6B",
		description:
			"Lightweight text embedding model with 1024-dimensional output and a 32K context, aimed at large-scale retrieval where latency and cost matter most.",
		family: "kinfra",
		output: ["embedding"],
		releasedAt: new Date("2026-06-30"),
		providers: [
			{
				providerId: "tencent",
				externalId: "kinfra-text-embedding-0.6b",
				inputPrice: "0.07e-6",
				outputPrice: "0",
				requestPrice: "0",
				contextSize: 32768,
				streaming: false,
				tools: false,
				jsonOutput: false,
				embeddings: true,
			},
		],
	},
	{
		id: "kinfra-text-embedding-4b",
		name: "Kinfra Text Embedding 4B",
		description:
			"High-quality text embedding model with 2560-dimensional output and a 32K context, aimed at deep semantic search.",
		family: "kinfra",
		output: ["embedding"],
		releasedAt: new Date("2026-06-30"),
		providers: [
			{
				providerId: "tencent",
				externalId: "kinfra-text-embedding-4b",
				inputPrice: "0.084e-6",
				outputPrice: "0",
				requestPrice: "0",
				contextSize: 32768,
				streaming: false,
				tools: false,
				jsonOutput: false,
				embeddings: true,
			},
		],
	},
] as const satisfies ModelDefinition[];
