import type { ModelDefinition } from "@/models.js";

export const deepseekModels = [
	{
		id: "deepseek-v3",
		name: "DeepSeek V3",
		description:
			"Large-scale Chinese AI model with strong multilingual capabilities.",
		family: "deepseek",
		releasedAt: new Date("2024-12-26"),
		providers: [
			{
				providerId: "nebius",
				stability: "unstable" as const,
				externalId: "deepseek-ai/DeepSeek-V3",
				inputPrice: "0.5e-6",
				outputPrice: "1.5e-6",
				requestPrice: "0",
				contextSize: 64000,
				maxOutput: undefined,
				streaming: true,
				vision: false,
				tools: false,
				jsonOutput: false,
				deactivatedAt: new Date("2025-11-03"),
			},
		],
	},
	{
		id: "deepseek-r1-0528",
		name: "DeepSeek R1 (0528)",
		description: "May 2028 version of DeepSeek R1 reasoning model.",
		family: "deepseek",
		releasedAt: new Date("2025-05-28"),
		providers: [
			{
				providerId: "nebius",
				externalId: "deepseek-ai/DeepSeek-R1-0528",
				inputPrice: "0.8e-6",
				outputPrice: "2.4e-6",
				requestPrice: "0",
				contextSize: 64000,
				maxOutput: undefined,
				streaming: true,
				vision: false,
				tools: false,
				stability: "unstable" as const,
				jsonOutput: false,
				deactivatedAt: new Date("2026-04-25"),
			},
		],
	},
	{
		id: "deepseek-r1-distill-llama-70b",
		name: "DeepSeek R1 Distill Llama 70B",
		description: "DeepSeek R1 distilled into Llama 70B architecture.",
		family: "deepseek",
		stability: "beta" as const,
		releasedAt: new Date("2025-01-20"),
		providers: [
			{
				providerId: "groq",
				externalId: "deepseek-r1-distill-llama-70b",
				inputPrice: "0.75e-6",
				outputPrice: "0.99e-6",
				requestPrice: "0",
				contextSize: 131072,
				maxOutput: undefined,
				streaming: true,
				vision: false,
				tools: true,
				jsonOutput: true,
				deactivatedAt: new Date("2025-10-09"),
			},
		],
	},
	{
		id: "deepseek-v3.1",
		name: "DeepSeek V3.1",
		description: "Updated DeepSeek V3 with tools and improved performance.",
		family: "deepseek",
		releasedAt: new Date("2025-08-21"),
		providers: [
			{
				providerId: "bytedance",
				externalId: "deepseek-v3-1-250821",
				deactivatedAt: new Date("2026-07-11"),
				inputPrice: "0.56e-6",
				cachedInputPrice: "0.112e-6",
				outputPrice: "1.68e-6",
				requestPrice: "0",
				contextSize: 128000,
				maxOutput: 32768,
				reasoning: true,
				reasoningOutput: "omit" as const,
				streaming: true,
				vision: false,
				tools: true,
				jsonOutput: false,
			},
		],
	},
	{
		id: "deepseek-v3.2",
		name: "DeepSeek V3.2",
		description: "Latest DeepSeek V3 with tools and improved performance.",
		family: "deepseek",
		releasedAt: new Date("2025-09-29"),
		providers: [
			{
				providerId: "deepseek",
				externalId: "deepseek-chat",
				inputPrice: "0.28e-6",
				outputPrice: "0.42e-6",
				cachedInputPrice: "0.028e-6",
				requestPrice: "0",
				contextSize: 163840,
				maxOutput: undefined,
				jsonOutput: true,
				streaming: true,
				vision: false,
				tools: true,
				// DeepSeek's API 400s on the OpenAI-only `developer` role
				// ("unknown variant `developer`, expected one of `system`, `user`,
				// `assistant`, `tool`, `latest_reminder`"), so it gets rewritten to
				// `system` before the request goes out.
				supportsDeveloperRole: false,
				deactivatedAt: new Date("2026-05-01"),
			},
			{
				providerId: "novita",
				externalId: "deepseek/deepseek-v3.2",
				inputPrice: "0.269e-6",
				cachedInputPrice: "0.1345e-6",
				outputPrice: "0.4e-6",
				requestPrice: "0",
				contextSize: 163840,
				maxOutput: 65536,
				quantization: "fp8",
				reasoning: true,
				requiresEnableThinking: true,
				streaming: true,
				vision: false,
				tools: true,
				jsonOutput: true,
				// reasoning_effort must NOT be forwarded: Novita ignores it on its
				// own and, sent alongside the `chat_template_kwargs.thinking` flag,
				// it suppresses reasoning entirely (verified live 2026-07-16).
				// Thinking is controlled solely via requiresEnableThinking.
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
				],
			},
			{
				providerId: "alibaba",
				externalId: "deepseek-v3.2",
				inputPrice: "0.57e-6",
				cachedInputPrice: "0.114e-6",
				outputPrice: "1.71e-6",
				regions: [
					{ id: "singapore" },
					{
						id: "cn-beijing",
						inputPrice: "0.287e-6",
						cachedInputPrice: "0.0574e-6",
						outputPrice: "0.431e-6",
					},
				],
				requestPrice: "0",
				contextSize: 131072,
				maxOutput: 65536,
				reasoning: false,
				streaming: true,
				vision: false,
				tools: true,
				jsonOutput: true,
				deactivatedAt: new Date("2026-07-08"),
			},
			{
				providerId: "bytedance",
				externalId: "deepseek-v3-2-251201",
				// Base fields are the [0, 32K] prompt-length band; Ark doubles the
				// input and output rates above it.
				inputPrice: "0.28e-6",
				cachedInputPrice: "0.056e-6",
				outputPrice: "0.42e-6",
				pricingTiers: [
					{
						name: "Up to 32K",
						upToTokens: 32768,
						inputPrice: "0.28e-6",
						outputPrice: "0.42e-6",
						cachedInputPrice: "0.056e-6",
					},
					{
						name: "Over 32K",
						upToTokens: Infinity,
						inputPrice: "0.56e-6",
						outputPrice: "0.84e-6",
						// The cache-hit rate is flat across both bands.
						cachedInputPrice: "0.056e-6",
					},
				],
				requestPrice: "0",
				contextSize: 131072,
				reasoning: true,
				// Ark ignores `reasoning_effort` on this deployment and only reasons
				// when sent `thinking: {type: "enabled"}`, which the gateway does not
				// emit for bytedance, so no reasoning content ever comes back.
				reasoningOutput: "omit" as const,
				maxOutput: 32768,
				streaming: true,
				vision: false,
				tools: true,
				jsonOutput: false,
			},
			{
				providerId: "nebius",
				externalId: "deepseek-ai/DeepSeek-V3.2",
				deactivatedAt: new Date("2026-06-22"),
				inputPrice: "0.3e-6",
				outputPrice: "0.45e-6",
				requestPrice: "0",
				contextSize: 163840,
				maxOutput: 32768,
				streaming: true,
				vision: false,
				tools: true,
				jsonOutput: true,
			},
			{
				providerId: "deepinfra",
				externalId: "deepseek-ai/DeepSeek-V3.2",
				inputPrice: "0.26e-6",
				cachedInputPrice: "0.13e-6",
				outputPrice: "0.38e-6",
				requestPrice: "0",
				contextSize: 160000,
				maxOutput: 65536,
				quantization: "fp4",
				streaming: true,
				vision: false,
				tools: true,
				jsonOutput: true,
			},
			{
				providerId: "vertex-openai",
				externalId: "deepseek-ai/deepseek-v3.2-maas",
				deactivatedAt: new Date("2026-10-21"),
				// Vertex MaaS throttles this model's tiny concurrency quota (429
				// RESOURCE_EXHAUSTED even for single spaced-out requests,
				// verified 2026-07-14), flaking e2e
				stability: "unstable",
				inputPrice: "0.56e-6",
				cachedInputPrice: "0.056e-6",
				outputPrice: "1.68e-6",
				requestPrice: "0",
				contextSize: 163840,
				maxOutput: 65536,
				streaming: true,
				vision: false,
				tools: true,
				jsonOutput: true,
			},
		],
	},
	{
		id: "deepseek-v4-pro",
		name: "DeepSeek V4 Pro",
		description:
			"DeepSeek's most capable V4 model with extended context and reasoning.",
		family: "deepseek",
		releasedAt: new Date("2026-04-24"),
		providers: [
			{
				providerId: "deepseek",
				externalId: "deepseek-v4-pro",
				// Peak hours (01:00-04:00 and 06:00-10:00 UTC) bill at the peak
				// rates below. All other hours and Beijing-time weekends bill at
				// the off-peak rates.
				inputPrice: "0.435e-6",
				outputPrice: "0.87e-6",
				cachedInputPrice: "0.003625e-6",
				peakPricing: {
					peak: {
						inputPrice: "1.32e-6",
						outputPrice: "3.96e-6",
						cachedInputPrice: "0.044e-6",
					},
					offPeak: {
						inputPrice: "0.66e-6",
						outputPrice: "1.98e-6",
						cachedInputPrice: "0.022e-6",
					},
					hoursUtc: [
						[1, 4],
						[6, 10],
					],
					offPeakDays: {
						daysOfWeek: [0, 6],
						utcOffsetMinutes: 480,
						timeZoneLabel: "Beijing time",
					},
				},
				requestPrice: "0",
				contextSize: 1050000,
				maxOutput: 393216,
				jsonOutput: true,
				streaming: true,
				reasoning: true,
				// DeepSeek maps `low` onto `high` on the pro model, so it is left
				// undeclared: `low` and `high` produce the same amount of thinking,
				// while `max` reasons several times longer. The flash deployment
				// does distinguish `low`, which is why it declares one more tier.
				reasoningEfforts: ["none", "high", "max"],
				vision: false,
				tools: true,
				// DeepSeek's API 400s on the OpenAI-only `developer` role
				// ("unknown variant `developer`, expected one of `system`, `user`,
				// `assistant`, `tool`, `latest_reminder`"), so it gets rewritten to
				// `system` before the request goes out.
				supportsDeveloperRole: false,
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
					"reasoning_effort",
				],
			},
			{
				providerId: "runware",
				externalId: "deepseek-v4-pro",
				inputPrice: "0.961e-6",
				outputPrice: "1.922e-6",
				cachedInputPrice: "0.079e-6",
				requestPrice: "0",
				contextSize: 1048576,
				maxOutput: 384000,
				quantization: "fp8",
				streaming: true,
				reasoning: true,
				// Runware maps reasoning_effort onto its thinkingLevel setting and
				// 400s minimal/low/medium for this model.
				reasoningEfforts: ["none", "high", "xhigh", "max"],
				vision: false,
				tools: true,
				// Runware rejects json_object for this model ("Missing required
				// parameter: 'jsonSchema'"); only schema-based output is supported.
				jsonOutput: false,
				jsonOutputSchema: true,
				// Runware 400s ("a conversation cannot end on an assistant turn") when
				// the last message is an assistant turn (verified 2026-07-28).
				supportsAssistantPrefill: false,
			},
			{
				providerId: "together-ai",
				externalId: "deepseek-ai/DeepSeek-V4-Pro-0813",
				// Together also lists an undated `deepseek-ai/DeepSeek-V4-Pro` slug at
				// its own (higher input, lower output) rate; this mapping must stay on
				// the dated -0813 slug's own live pricing, not that one.
				inputPrice: "1.32e-6",
				cachedInputPrice: "0.13e-6",
				outputPrice: "3.96e-6",
				requestPrice: "0",
				contextSize: 1048576,
				maxOutput: 163840,
				streaming: true,
				reasoning: true,
				// Together's docs list two native effort levels (high, max);
				// low/medium are normalized to high and xhigh to max upstream.
				// `none` is honoured through the `thinking` switch, not through
				// reasoning_effort.
				reasoningEfforts: ["none", "high", "max"],
				requiresDisableThinkingParam: true,
				reasoningOutput: "omit",
				vision: false,
				tools: true,
				jsonOutput: true,
				jsonOutputSchema: true,
			},
			{
				providerId: "alibaba",
				externalId: "deepseek-v4-pro-0813",
				inputPrice: "2.4e-6",
				cachedInputPrice: "0.2e-6",
				outputPrice: "4.8e-6",
				regions: [
					{ id: "singapore" },
					{ id: "eu-frankfurt" },
					{ id: "us-virginia" },
					{
						id: "cn-beijing",
						inputPrice: "1.65e-6",
						cachedInputPrice: "0.138e-6",
						outputPrice: "3.301e-6",
					},
				],
				requestPrice: "0",
				contextSize: 1000000,
				maxOutput: 393216,
				streaming: true,
				reasoning: true,
				reasoningMaxTokens: true,
				// DashScope is driven through `enable_thinking`/`thinking_budget`,
				// never `reasoning_effort`, so every tier maps onto its own native
				// budget and is genuinely distinct; `none` disables thinking outright.
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
				jsonOutput: true,
			},
			{
				providerId: "deepinfra",
				externalId: "deepseek-ai/DeepSeek-V4-Pro",
				inputPrice: "1.3e-6",
				cachedInputPrice: "0.1e-6",
				outputPrice: "2.6e-6",
				requestPrice: "0",
				contextSize: 1048576,
				maxOutput: 64000,
				quantization: "fp8",
				streaming: true,
				reasoning: true,
				reasoningEfforts: ["none", "high", "max"],
				vision: false,
				tools: true,
				jsonOutput: true,
			},
			{
				providerId: "bytedance",
				// The GA deployment, which is the same 0813 build the other providers
				// serve here. `deepseek-v4-pro-260425` is the superseded preview and
				// carries its own (higher input, lower output) rate card.
				externalId: "deepseek-v4-pro-ga-260813",
				inputPrice: "1.32e-6",
				cachedInputPrice: "0.044e-6",
				outputPrice: "3.96e-6",
				requestPrice: "0",
				contextSize: 1048576,
				maxOutput: 393216,
				streaming: true,
				reasoning: true,
				// The GA deployment accepts the full enum; the preview 400d `none` and
				// `xhigh` ("Valid values are: ['high', 'low', 'max', 'medium',
				// 'minimal']"). `none` and `minimal` both return no reasoning at all.
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
				jsonOutput: false,
			},
			{
				providerId: "nebius",
				externalId: "deepseek-ai/DeepSeek-V4-Pro",
				inputPrice: "1.75e-6",
				outputPrice: "3.5e-6",
				requestPrice: "0",
				contextSize: 1048576,
				maxOutput: undefined,
				quantization: "fp8",
				streaming: true,
				reasoning: true,
				// The deployment answers inline and never returns
				// reasoning_content (verified 2026-07-22).
				reasoningOutput: "omit",
				vision: false,
				tools: true,
				jsonOutput: true,
			},
			{
				providerId: "canopywave",
				externalId: "deepseek/deepseek-v4-pro",
				// Unlike Flash (whose CanopyWave listing/title is
				// deepseek-v4-flash-0731), Pro has no dated/GA slug here: the live
				// listing's description still opens "We present a preview version of
				// DeepSeek-V4 series..." (verified 2026-08-18). Pricing is correct
				// for what's actually served — the preview build, not 0813 GA.
				inputPrice: "1.74e-6",
				cachedInputPrice: "0.01e-6",
				outputPrice: "3.48e-6",
				requestPrice: "0",
				contextSize: 1000000,
				maxOutput: 393216,
				quantization: "fp8",
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
				// The deployment 400s on "required" and named-function tool_choice
				// with "Thinking mode does not support this tool_choice"; both only
				// work when thinking is off, which the catalogue cannot express, so
				// they coerce to "auto" (verified 2026-08-09).
				supportedToolChoices: ["auto", "none"],
				jsonOutput: true,
			},
			{
				providerId: "fireworks",
				// Fireworks keeps the unversioned `deepseek-v4-pro` slug pointed at
				// the original preview build, at its own rate card, even after the
				// 0813 GA release; the GA build only serves under this dedicated slug.
				externalId: "accounts/fireworks/models/deepseek-v4-pro-0813",
				inputPrice: "1.32e-6",
				cachedInputPrice: "0.044e-6",
				outputPrice: "3.96e-6",
				requestPrice: "0",
				// Fireworks prices DeepSeek's Priority tier at 1.5x standard rather
				// than the 1.25x that applies to the rest of its catalogue.
				serviceTiers: ["priority"],
				serviceTierMultipliers: { priority: 1.5 },
				contextSize: 1048576,
				maxOutput: 393216,
				streaming: true,
				reasoning: true,
				// Fireworks rejects "minimal" for this model; the rest of the enum
				// (plus "none" for non-thinking mode) is accepted.
				reasoningEfforts: ["none", "low", "medium", "high", "xhigh", "max"],
				vision: false,
				tools: true,
				jsonOutput: true,
				jsonOutputSchema: true,
			},
			{
				providerId: "baidu",
				externalId: "deepseek-v4-pro",
				// Unlike Flash (which Qianfan lists separately as
				// deepseek-v4-flash-0731), Qianfan has no dated/GA slug for Pro:
				// this listing's hugging_face_id is still deepseek-ai/DeepSeek-V4-Pro
				// (the pre-0813 preview repo) and its description never mentions an
				// official/GA release (verified 2026-08-18). Pricing is correct for
				// what's actually served — the preview build, not 0813 GA.
				inputPrice: "1.69e-6",
				cachedInputPrice: "0.14e-6",
				outputPrice: "3.38e-6",
				requestPrice: "0",
				contextSize: 1048576,
				// /v1/models reports 393216 while Qianfan's model page caps output at
				// 128K; the lower bound is the safe one to advertise.
				maxOutput: 131072,
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
				// Qianfan ignores reasoning_effort="none"; its thinking switch works.
				requiresDisableThinkingParam: true,
				vision: false,
				tools: true,
				jsonOutput: true,
			},
		],
	},
	{
		id: "deepseek-v4-flash",
		name: "DeepSeek V4 Flash",
		description:
			"DeepSeek's fast and cost-efficient V4 model with extended context and reasoning.",
		family: "deepseek",
		releasedAt: new Date("2026-04-24"),
		providers: [
			{
				providerId: "deepseek",
				externalId: "deepseek-v4-flash",
				// Peak hours (01:00-04:00 and 06:00-10:00 UTC) bill at the peak
				// rates below. All other hours and Beijing-time weekends bill at
				// the off-peak rates.
				inputPrice: "0.14e-6",
				outputPrice: "0.28e-6",
				cachedInputPrice: "0.0028e-6",
				peakPricing: {
					peak: {
						inputPrice: "0.44e-6",
						outputPrice: "1.32e-6",
						cachedInputPrice: "0.014e-6",
					},
					offPeak: {
						inputPrice: "0.22e-6",
						outputPrice: "0.66e-6",
						cachedInputPrice: "0.007e-6",
					},
					hoursUtc: [
						[1, 4],
						[6, 10],
					],
					offPeakDays: {
						daysOfWeek: [0, 6],
						utcOffsetMinutes: 480,
						timeZoneLabel: "Beijing time",
					},
				},
				requestPrice: "0",
				contextSize: 1050000,
				maxOutput: 393216,
				jsonOutput: true,
				streaming: true,
				reasoning: true,
				reasoningEfforts: ["none", "low", "high", "max"],
				vision: false,
				tools: true,
				// DeepSeek's API 400s on the OpenAI-only `developer` role
				// ("unknown variant `developer`, expected one of `system`, `user`,
				// `assistant`, `tool`, `latest_reminder`"), so it gets rewritten to
				// `system` before the request goes out.
				supportsDeveloperRole: false,
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
					"reasoning_effort",
				],
			},
			{
				providerId: "runware",
				externalId: "deepseek-v4-flash",
				inputPrice: "0.076e-6",
				outputPrice: "0.153e-6",
				cachedInputPrice: "0.014e-6",
				requestPrice: "0",
				contextSize: 1048576,
				maxOutput: 384000,
				quantization: "fp8",
				streaming: true,
				reasoning: true,
				// Runware maps reasoning_effort onto its thinkingLevel setting and
				// 400s minimal/low/medium for this model.
				reasoningEfforts: ["none", "high", "xhigh", "max"],
				vision: false,
				tools: true,
				// Runware rejects json_object for this model ("Missing required
				// parameter: 'jsonSchema'"); only schema-based output is supported.
				jsonOutput: false,
				jsonOutputSchema: true,
				// Runware 400s ("a conversation cannot end on an assistant turn") when
				// the last message is an assistant turn (verified 2026-07-28).
				supportsAssistantPrefill: false,
			},
			{
				providerId: "novita",
				externalId: "deepseek/deepseek-v4-flash-0731",
				inputPrice: "0.14e-6",
				cachedInputPrice: "0.028e-6",
				outputPrice: "0.28e-6",
				requestPrice: "0",
				contextSize: 1050000,
				maxOutput: 393216,
				quantization: "fp8",
				streaming: true,
				reasoning: true,
				// Novita documents no reasoning_effort tiers for this model, so none
				// are declared; the gateway still forwards whatever the caller sends.
				vision: false,
				tools: true,
				// The -0731 deployment 400s on "required" and named-function
				// tool_choice, and silently emits no tool call at all when "required"
				// is streamed; only "auto"/"none" behave (verified 2026-08-02).
				supportedToolChoices: ["auto", "none"],
				jsonOutput: true,
			},
			{
				providerId: "alibaba",
				externalId: "deepseek-v4-flash-0731",
				inputPrice: "0.2e-6",
				cachedInputPrice: "0.04e-6",
				outputPrice: "0.4e-6",
				regions: [
					{ id: "singapore" },
					{ id: "eu-frankfurt" },
					{ id: "us-virginia" },
					{
						id: "cn-beijing",
						inputPrice: "0.138e-6",
						cachedInputPrice: "0.028e-6",
						outputPrice: "0.275e-6",
					},
				],
				requestPrice: "0",
				contextSize: 1000000,
				maxOutput: 393216,
				streaming: true,
				reasoning: true,
				reasoningMaxTokens: true,
				// DashScope is driven through `enable_thinking`/`thinking_budget`,
				// never `reasoning_effort`, so every tier maps onto its own native
				// budget and is genuinely distinct; `none` disables thinking outright.
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
				jsonOutput: true,
			},
			{
				providerId: "deepinfra",
				externalId: "deepseek-ai/DeepSeek-V4-Flash-0731",
				inputPrice: "0.08e-6",
				cachedInputPrice: "0.016e-6",
				outputPrice: "0.18e-6",
				requestPrice: "0",
				contextSize: 1000000,
				maxOutput: 393216,
				quantization: "fp8",
				streaming: true,
				reasoning: true,
				// DeepInfra keeps thinking off unless an effort is requested, and
				// takes `none` to keep it off, exactly like its V4 Pro deployment.
				reasoningEfforts: ["none", "low", "high", "max"],
				vision: false,
				tools: true,
				jsonOutput: true,
			},
			{
				providerId: "bytedance",
				// The GA deployment; `deepseek-v4-flash-260425` is the superseded
				// preview.
				externalId: "deepseek-v4-flash-ga-260731",
				inputPrice: "0.44e-6",
				cachedInputPrice: "0.014e-6",
				outputPrice: "1.32e-6",
				requestPrice: "0",
				contextSize: 1048576,
				maxOutput: 393216,
				streaming: true,
				reasoning: true,
				// `none` and `minimal` both return no reasoning at all.
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
				jsonOutput: false,
			},
			{
				providerId: "fireworks",
				// The undated `deepseek-v4-flash` alias still resolves to the launch
				// snapshot; `-0731` is the current deployment.
				externalId: "accounts/fireworks/models/deepseek-v4-flash-0731",
				inputPrice: "0.14e-6",
				cachedInputPrice: "0.028e-6",
				outputPrice: "0.28e-6",
				requestPrice: "0",
				// Fireworks prices DeepSeek's Priority tier at 1.5x standard rather
				// than the 1.25x that applies to the rest of its catalogue.
				serviceTiers: ["priority"],
				serviceTierMultipliers: { priority: 1.5 },
				contextSize: 1048576,
				maxOutput: 393216,
				streaming: true,
				reasoning: true,
				// Fireworks rejects "minimal" for this model; the rest of the enum
				// (plus "none" for non-thinking mode) is accepted.
				reasoningEfforts: ["none", "low", "medium", "high", "xhigh", "max"],
				vision: false,
				tools: true,
				jsonOutput: true,
				jsonOutputSchema: true,
			},
			{
				providerId: "together-ai",
				externalId: "deepseek-ai/DeepSeek-V4-Flash-0731",
				inputPrice: "0.14e-6",
				cachedInputPrice: "0.03e-6",
				outputPrice: "0.28e-6",
				requestPrice: "0",
				contextSize: 163840,
				maxOutput: 163840,
				streaming: true,
				reasoning: true,
				// Together's deployment accepts any reasoning_effort string without
				// validating it, and only the top tiers measurably change behaviour:
				// xhigh and max roughly double the reasoning tokens, while
				// low/medium/high land on the provider default. `none` is honoured
				// through the `thinking` switch, not through reasoning_effort.
				reasoningEfforts: ["none", "xhigh", "max"],
				requiresDisableThinkingParam: true,
				reasoningOutput: "omit",
				vision: false,
				tools: true,
				jsonOutput: true,
				jsonOutputSchema: true,
			},
			{
				// RanoAI serves DeepSeek V4 Flash on Furiosa RNGD NPUs. The NPU
				// deployment exposes a 1M-token context and accepts up to 393216 output
				// tokens, rejecting 393217.
				// Reasoning arrives as `reasoning_content` (streamed as deltas) only
				// when `reasoning_effort` is passed explicitly — a request without it
				// returns no reasoning at all, and "none" suppresses it.
				// `reasoning_tokens` is reported inside completion_tokens, so costs.ts
				// lists this provider in completionIncludesReasoning.
				//
				// All four tool_choice modes are honoured, so none are declared here.
				// The endpoint silently ignores n > 1 and returns one choice, so this
				// mapping must not advertise supportsN.
				// Prompt caching is automatic prefix caching — the first request
				// misses and later ones report `cached_tokens` — priced at the
				// `input_cache_read` rate /v1/models advertises.
				providerId: "ranoai",
				externalId: "deepseek-v4-flash",
				inputPrice: "0.14e-6",
				outputPrice: "0.28e-6",
				cachedInputPrice: "0.028e-6",
				requestPrice: "0",
				contextSize: 1000000,
				maxOutput: 393216,
				// RanoAI serves NVFP4 weights; the catalogue's quantization union only
				// carries the generic 4-bit float value.
				quantization: "fp4",
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
				// json_object returns valid JSON but often ignores requested fields and
				// emits an empty object; schema-constrained output is reliable.
				jsonOutput: false,
				jsonOutputSchema: true,
			},
			{
				providerId: "canopywave",
				externalId: "deepseek/deepseek-v4-flash",
				inputPrice: "0.14e-6",
				cachedInputPrice: "0.03e-6",
				outputPrice: "0.28e-6",
				requestPrice: "0",
				contextSize: 1000000,
				maxOutput: 393216,
				quantization: "fp8",
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
				// The deployment 400s on "required" and named-function tool_choice
				// with "Thinking mode does not support this tool_choice"; both only
				// work when thinking is off, which the catalogue cannot express, so
				// they coerce to "auto" (verified 2026-08-09).
				supportedToolChoices: ["auto", "none"],
				jsonOutput: true,
			},
			{
				providerId: "gonka24",
				externalId: "deepseek-v4-flash-0731",
				inputPrice: "0.075e-6",
				cachedInputPrice: "0.0155e-6",
				outputPrice: "0.175e-6",
				requestPrice: "0",
				// The deployment shares one 390000-token window between prompt and
				// completion, and stops generating at 16384 tokens with
				// finish_reason "length" no matter how high max_tokens is.
				contextSize: 390000,
				maxOutput: 16384,
				streaming: true,
				reasoning: true,
				// The provider's accepted enum; anything outside it is a hard 400.
				// Thinking is off by default and is turned on by the binary `thinking`
				// switch the gateway derives from the effort (see the gonka24 case in
				// prepare-request-body), not by the effort itself.
				reasoningEfforts: ["none", "low", "medium", "high"],
				vision: false,
				tools: true,
				// tool_choice "required" is not enforced — the model keeps answering
				// in plain text — so it coerces to "auto"; named-function choice is
				// honoured.
				supportedToolChoices: ["auto", "none", "function"],
				// The gateway rejects the OpenAI-only `developer` role ("Invalid enum
				// value. Expected 'system' | 'user' | 'assistant' | 'tool'").
				supportsDeveloperRole: false,
				jsonOutput: true,
				// `json_schema` is only prompt-steered, not constrained-decoded: the
				// deployment emits the right keys but never stops, running into the
				// output cap and returning truncated, unparseable JSON.
				jsonOutputSchema: false,
			},
			{
				providerId: "baidu",
				externalId: "deepseek-v4-flash",
				inputPrice: "0.14e-6",
				cachedInputPrice: "0.028e-6",
				outputPrice: "0.28e-6",
				requestPrice: "0",
				contextSize: 1048576,
				maxOutput: 131072,
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
				// Qianfan ignores reasoning_effort="none"; its thinking switch works.
				requiresDisableThinkingParam: true,
				vision: false,
				tools: true,
				jsonOutput: true,
			},
		],
	},
] as const satisfies ModelDefinition[];
