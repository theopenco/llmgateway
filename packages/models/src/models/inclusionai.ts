import type { ModelDefinition } from "@/models.js";

export const inclusionaiModels = [
	{
		id: "ling-3.0-flash",
		name: "Ling 3.0 Flash",
		description:
			"InclusionAI's native hybrid-reasoning MoE model (124B total, 5.1B active) with strong agentic and coding performance.",
		family: "inclusionai",
		releasedAt: new Date("2026-08-02"),
		providers: [
			{
				providerId: "deepinfra",
				externalId: "inclusionAI/Ling-3.0-flash",
				inputPrice: "0.06e-6",
				cachedInputPrice: "0.012e-6",
				outputPrice: "0.18e-6",
				requestPrice: "0",
				contextSize: 262144,
				maxOutput: 32768,
				streaming: true,
				// Thinking is enabled by default via the vLLM chat template; only
				// disabling is exposed through the chat-template flag, so only
				// `none` is advertised as a supported reasoning effort.
				reasoning: true,
				reasoningEfforts: ["none"],
				chatTemplateThinkingKey: "enable_thinking",
				// Thinking is controlled solely via the chat-template flag, so
				// `reasoning_effort` must NOT be forwarded to the provider.
				supportedParameters: [
					"temperature",
					"max_tokens",
					"top_p",
					"frequency_penalty",
					"presence_penalty",
					"stop",
					"stream",
					"response_format",
					"tools",
					"tool_choice",
				],
				vision: false,
				tools: true,
				jsonOutput: true,
			},
			{
				providerId: "novita",
				externalId: "inclusionai/ling-3.0-flash",
				inputPrice: "0.06e-6",
				cachedInputPrice: "0.012e-6",
				outputPrice: "0.18e-6",
				requestPrice: "0",
				contextSize: 262144,
				maxOutput: 32768,
				streaming: true,
				reasoning: true,
				// Novita backend ignores chat_template_kwargs.enable_thinking (verified
				// live 2026-08-10) — thinking is always on, no client control.
				reasoningEfforts: [],
				// Novita rejects response_format outright for this model
				// ("does not support feature: structured-outputs"), for both
				// json_object and json_schema.
				supportedParameters: [
					"temperature",
					"max_tokens",
					"top_p",
					"frequency_penalty",
					"presence_penalty",
					"stop",
					"stream",
					"tools",
					"tool_choice",
				],
				vision: false,
				tools: true,
				jsonOutput: false,
			},
		],
	},
] as const satisfies ModelDefinition[];
