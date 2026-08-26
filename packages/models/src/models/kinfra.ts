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
	{
		id: "kinfra-vl-embedding-2b",
		name: "Kinfra VL Embedding 2B",
		description:
			"Lightweight multimodal embedding model with 2048-dimensional output, built for multimodal retrieval where response speed is the priority.",
		family: "kinfra",
		output: ["embedding"],
		releasedAt: new Date("2026-06-30"),
		providers: [
			{
				providerId: "tencent",
				externalId: "kinfra-vl-embedding-2b",
				// TokenHub bills this model per input modality (text 0.07, image
				// 0.098, video 0.21 per million tokens). The gateway's embeddings
				// input schema only accepts strings and token IDs, so every
				// request that can reach it is text and the text rate is the only
				// one that can ever apply. Revisit if image/video embedding input
				// is ever added.
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
		id: "kinfra-vl-embedding-8b",
		name: "Kinfra VL Embedding 8B",
		description:
			"High-precision multimodal embedding model with 4096-dimensional output, built for accuracy-first multimodal retrieval.",
		family: "kinfra",
		output: ["embedding"],
		releasedAt: new Date("2026-06-30"),
		providers: [
			{
				providerId: "tencent",
				externalId: "kinfra-vl-embedding-8b",
				// Text rate only, for the same reason as kinfra-vl-embedding-2b:
				// image input is 0.126 and video 0.252 per million tokens, neither
				// of which the embeddings endpoint can currently produce.
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
