import type { ModelDefinition } from "@/models.js";

export const tencentModels = [
	{
		id: "hy3",
		name: "Hy3",
		description:
			"Tencent's 295B Mixture-of-Experts model with 21B active parameters, native 256K context support, and three reasoning modes for complex reasoning and agentic tasks.",
		family: "tencent",
		releasedAt: new Date("2026-07-06"),
		providers: [
			{
				providerId: "deepinfra",
				externalId: "tencent/Hy3",
				inputPrice: "0.14e-6",
				cachedInputPrice: "0.035e-6",
				outputPrice: "0.58e-6",
				requestPrice: "0",
				contextSize: 262144,
				maxOutput: 131072,
				quantization: "fp8",
				streaming: true,
				reasoning: true,
				reasoningEfforts: ["none", "low", "high"],
				vision: false,
				tools: true,
				jsonOutput: true,
				jsonOutputSchema: true,
			},
			{
				providerId: "novita",
				externalId: "tencent/hy3",
				inputPrice: "0.14e-6",
				cachedInputPrice: "0.035e-6",
				outputPrice: "0.58e-6",
				requestPrice: "0",
				contextSize: 262144,
				maxOutput: 262144,
				streaming: true,
				reasoning: true,
				reasoningEfforts: ["none", "low", "high"],
				vision: false,
				tools: true,
				// novita 400s on a named function choice for this deployment
				supportedToolChoices: ["auto", "none", "required"],
				jsonOutputSchema: true,
			},
			{
				providerId: "tencent",
				externalId: "hy3",
				inputPrice: "0.132e-6",
				cachedInputPrice: "0.033e-6",
				outputPrice: "0.528e-6",
				requestPrice: "0",
				contextSize: 262144,
				maxOutput: 131072,
				streaming: true,
				reasoning: true,
				// `max` is the one tier this deployment 400s on; the rest are
				// accepted and `none` genuinely reports zero reasoning tokens.
				reasoningEfforts: ["none", "minimal", "low", "medium", "high", "xhigh"],
				// Accepts image parts with a 200 but cannot read them — asked to
				// name the digit drawn in a test image it answered "8" for a "7",
				// while the sighted mappings all read it correctly.
				vision: false,
				tools: true,
				jsonOutput: true,
				jsonOutputSchema: true,
			},
		],
	},
	{
		id: "hy-mt2-plus",
		name: "Hy-MT2 Plus",
		description:
			"Tencent's Hunyuan translation model, tuned for translation quality and instruction following across a short 8K context.",
		family: "tencent",
		releasedAt: new Date("2026-05-21"),
		providers: [
			{
				providerId: "tencent",
				externalId: "hy-mt2-plus",
				inputPrice: "0.074e-6",
				outputPrice: "0.295e-6",
				requestPrice: "0",
				contextSize: 8192,
				maxOutput: 4096,
				streaming: true,
				vision: false,
				// A translation model: it answers the prompt but ignores tools,
				// `tool_choice` and `response_format` entirely rather than
				// rejecting them, so nothing beyond plain text is declared.
				tools: false,
				jsonOutput: false,
			},
		],
	},
] as const satisfies ModelDefinition[];
