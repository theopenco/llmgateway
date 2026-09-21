import type { ModelDefinition } from "@/models.js";

export const atriaModels = [
	{
		id: "atria-dawn-preview",
		name: "Atria Dawn Preview",
		description:
			"Agentic research model for long-horizon analysis, code and tool use.",
		family: "atria",
		free: true,
		stability: "unstable",
		releasedAt: new Date("2026-09-12"),
		providers: [
			{
				providerId: "atria",
				externalId: "Atria-Dawn-Preview",
				inputPrice: "0",
				// Upstream does cache prefixes, but hits land only when a request
				// reaches the replica that built them, so a repeat prompt reports
				// cached_tokens 0 as often as not. Left undeclared rather than
				// promising caching the gateway cannot rely on; the rate is 0 either way.
				outputPrice: "0",
				requestPrice: "0",
				contextSize: 262144,
				maxOutput: 65536,
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
				vision: false,
				tools: true,
				// "required" and a named function return finish_reason "tool_calls"
				// with no tool_calls and the raw <tool_call> template leaked into
				// content, so both downgrade to "auto".
				supportedToolChoices: ["auto", "none"],
				// Guided decoding emits a spurious leading brace ('{{...' / '{"{...'),
				// so response_format yields unparseable JSON; the model produces valid
				// JSON when simply asked for it.
				jsonOutput: false,
				jsonOutputSchema: false,
				supportedParameters: [
					"temperature",
					"max_tokens",
					"top_p",
					"frequency_penalty",
					"presence_penalty",
					"stop",
					"seed",
					"logprobs",
					"top_logprobs",
					"n",
					"stream",
					"tools",
					"tool_choice",
					"reasoning_effort",
				],
			},
		],
	},
] as const satisfies ModelDefinition[];
