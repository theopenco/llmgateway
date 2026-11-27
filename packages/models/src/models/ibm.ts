import type { ModelDefinition } from "@/models.js";

export const ibmModels = [
	{
		id: "granite-4.2-8b",
		name: "Granite 4.2 8B",
		description:
			"IBM's dense 8B reasoning model for math, code generation, multilingual dialogue, and agentic workflows.",
		family: "ibm",
		releasedAt: new Date("2026-09-01"),
		providers: [
			{
				providerId: "deepinfra",
				externalId: "ibm-granite/granite-4.2-8b",
				inputPrice: "0.06e-6",
				cachedInputPrice: "0.015e-6",
				outputPrice: "0.25e-6",
				requestPrice: "0",
				contextSize: 131072,
				maxOutput: 117964,
				quantization: "bf16",
				maxTemperature: 1,
				streaming: true,
				reasoning: true,
				reasoningEfforts: ["none", "low", "medium", "high"],
				vision: false,
				tools: true,
				supportedToolChoices: ["auto", "none", "function"],
				jsonOutput: true,
				// DeepInfra deprecates this model on 2026-12-03 and then silently
				// redirects requests to Qwen/Qwen3.5-9B, so stop routing to it on
				// that date instead of serving a different model under this id.
				deactivatedAt: new Date("2026-12-03"),
			},
		],
	},
] as const satisfies ModelDefinition[];
