import type { ModelDefinition } from "@/models.js";

export const nousresearchModels = [
	{
		id: "hermes-4-405b",
		name: "Hermes 4 405B",
		description:
			"Nous Research Hermes 4 flagship hybrid reasoning model based on Llama 3.1 405B.",
		family: "nousresearch",
		releasedAt: new Date("2025-08-26"),
		providers: [
			{
				providerId: "nebius",
				externalId: "NousResearch/Hermes-4-405B",
				inputPrice: "1.0e-6",
				outputPrice: "3.0e-6",
				requestPrice: "0",
				contextSize: 131072,
				maxOutput: undefined,
				quantization: "fp8",
				streaming: true,
				reasoning: true,
				// Hermes 4 only thinks when the caller opts in via the model's
				// think-style system prompt, so structured reasoning output is
				// not guaranteed (verified 2026-07-22).
				reasoningOutput: "omit",
				// When thinking is prompted, the deployment emits <think>...</think>
				// inside content rather than reasoning_content, so split it.
				splitTaggedReasoning: true,
				vision: false,
				tools: true,
				jsonOutput: true,
			},
		],
	},
	{
		id: "hermes-4-70b",
		name: "Hermes 4 70B",
		description:
			"Nous Research Hermes 4 hybrid reasoning model based on Llama 3.1 70B.",
		family: "nousresearch",
		releasedAt: new Date("2025-08-26"),
		providers: [
			{
				providerId: "nebius",
				externalId: "NousResearch/Hermes-4-70B",
				inputPrice: "0.13e-6",
				outputPrice: "0.4e-6",
				requestPrice: "0",
				contextSize: 131072,
				maxOutput: undefined,
				quantization: "fp8",
				streaming: true,
				reasoning: true,
				// Hermes 4 only thinks when the caller opts in via the model's
				// think-style system prompt, so structured reasoning output is
				// not guaranteed (verified 2026-07-22).
				reasoningOutput: "omit",
				// When thinking is prompted, the deployment emits <think>...</think>
				// inside content rather than reasoning_content, so split it.
				splitTaggedReasoning: true,
				vision: false,
				tools: true,
				jsonOutput: true,
			},
		],
	},
	{
		id: "hermes-3-llama-405b",
		name: "Hermes 3 Llama 405B",
		description: "Nous Research Hermes 3 based on Llama 405B.",
		family: "nousresearch",
		releasedAt: new Date("2024-08-16"),
		providers: [
			{
				providerId: "nebius",
				externalId: "NousResearch/Hermes-3-Llama-405B",
				inputPrice: "1.0e-6",
				outputPrice: "3.0e-6",
				requestPrice: "0",
				contextSize: 131072,
				maxOutput: undefined,
				streaming: true,
				vision: false,
				tools: false,
				jsonOutput: true,
				deactivatedAt: new Date("2025-11-03"),
			},
		],
	},
	{
		id: "hermes-2-pro-llama-3-8b",
		name: "Hermes 2 Pro Llama 3 8B",
		description: "Nous Research Hermes 2 Pro based on Llama 3 8B.",
		family: "nousresearch",
		releasedAt: new Date("2024-05-27"),
		providers: [
			{
				providerId: "novita",
				stability: "unstable",
				externalId: "nousresearch/hermes-2-pro-llama-3-8b",
				inputPrice: "0.14e-6",
				outputPrice: "0.14e-6",
				requestPrice: "0",
				contextSize: 8192,
				maxOutput: 8192,
				quantization: "fp16",
				streaming: true,
				vision: false,
				tools: false,
				jsonOutput: false,
				deactivatedAt: new Date("2026-06-05"),
			},
		],
	},
] as const satisfies ModelDefinition[];
