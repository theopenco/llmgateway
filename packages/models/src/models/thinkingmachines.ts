import type { ModelDefinition } from "@/models.js";

export const thinkingmachinesModels = [
	{
		id: "inkling",
		name: "Inkling",
		description:
			"Thinking Machines Lab's open-weight multimodal MoE model (975B total, 41B active) for reasoning, coding, and agentic tool use.",
		family: "thinkingmachines",
		releasedAt: new Date("2026-07-18"),
		providers: [
			{
				providerId: "together-ai",
				externalId: "thinkingmachines/Inkling",
				// Together caches this prefix only about two runs in three, so the
				// mapping cannot be relied on for cache-priced traffic.
				deactivatedAt: new Date("2026-09-23"),
				inputPrice: "1e-6",
				cachedInputPrice: "0.17e-6",
				outputPrice: "4.05e-6",
				requestPrice: "0",
				contextSize: 524288,
				maxOutput: 471859,
				quantization: "fp8",
				streaming: true,
				reasoning: true,
				// low and medium intermittently return tool calls with no reasoning
				// text at all, so only the tiers that always emit it are offered.
				reasoningEfforts: ["none", "high", "xhigh", "max"],
				vision: true,
				tools: true,
				jsonOutput: true,
				jsonOutputSchema: true,
			},
			{
				providerId: "deepinfra",
				externalId: "thinkingmachines/Inkling",
				inputPrice: "0.95e-6",
				cachedInputPrice: "0.16e-6",
				outputPrice: "4.05e-6",
				requestPrice: "0",
				contextSize: 524288,
				maxOutput: 262144,
				quantization: "fp8",
				maxTemperature: 1,
				streaming: true,
				reasoning: true,
				reasoningEfforts: [
					"none",
					"minimal",
					"low",
					"medium",
					"high",
					"xhigh",
					"max",
				],
				vision: true,
				tools: false,
				jsonOutput: false,
			},
		],
	},
	{
		id: "inkling-small",
		name: "Inkling Small",
		description:
			"Smaller, more efficient member of Thinking Machines Lab's open-weight multimodal Inkling family (276B total, 12B active).",
		family: "thinkingmachines",
		releasedAt: new Date("2026-07-31"),
		providers: [
			{
				providerId: "deepinfra",
				externalId: "thinkingmachines/Inkling-Small",
				// Intermittently returns tool calls with no reasoning text and
				// json_object responses that ignore the requested shape.
				deactivatedAt: new Date("2026-09-23"),
				inputPrice: "0.45e-6",
				cachedInputPrice: "0.1e-6",
				outputPrice: "1.2e-6",
				requestPrice: "0",
				contextSize: 524288,
				maxOutput: 262144,
				quantization: "fp8",
				maxTemperature: 1,
				streaming: true,
				reasoning: true,
				// low and medium intermittently return tool calls with no reasoning
				// text at all, so only the tiers that always emit it are offered.
				reasoningEfforts: ["none", "high", "xhigh", "max"],
				vision: true,
				tools: true,
				jsonOutput: true,
				jsonOutputSchema: true,
			},
		],
	},
] as const satisfies ModelDefinition[];
