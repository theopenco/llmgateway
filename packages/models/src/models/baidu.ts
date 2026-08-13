import type { ModelDefinition } from "@/models.js";

export const baiduModels = [
	{
		id: "ernie-4.5-vl-424b-a47b",
		name: "ERNIE 4.5 VL 424B A47B",
		description:
			"Baidu's multimodal Mixture-of-Experts model (424B total, 47B active) jointly trained on text and images, with an optional thinking mode.",
		family: "baidu",
		releasedAt: new Date("2025-06-30"),
		providers: [
			{
				providerId: "novita",
				externalId: "baidu/ernie-4.5-vl-424b-a47b",
				inputPrice: "0.42e-6",
				outputPrice: "1.25e-6",
				requestPrice: "0",
				contextSize: 123000,
				maxOutput: 16000,
				streaming: true,
				vision: true,
				// The deployment rejects a remote PNG URL with a bare "invalid
				// request error" (a remote JPEG works), but accepts the same PNG
				// bytes as a data URL, so images are inlined before they go out.
				requiresBase64Images: true,
				tools: false,
				// "model features function calling not support" / "does not support
				// feature: structured-outputs" — both are hard 400s upstream.
				jsonOutput: false,
				reasoning: true,
				chatTemplateThinkingKey: "enable_thinking",
				// Thinking is off by default and controlled solely via the
				// chat-template flag. `reasoning_effort` must NOT be forwarded:
				// sent alongside the flag it suppresses reasoning entirely.
				supportedParameters: [
					"temperature",
					"max_tokens",
					"top_p",
					"frequency_penalty",
					"presence_penalty",
					"stop",
					"stream",
				],
			},
		],
	},
	{
		id: "ernie-5.0",
		name: "ERNIE 5.0",
		description:
			"Baidu's flagship natively multimodal model with a 248k context window, accepting text, image, and video input and thinking before it answers.",
		family: "baidu",
		releasedAt: new Date("2026-03-05"),
		providers: [
			{
				providerId: "baidu" as const,
				externalId: "ernie-5.0",
				inputPrice: "1.4e-6",
				outputPrice: "5.6e-6",
				requestPrice: "0",
				contextSize: 248832,
				maxOutput: 126976,
				streaming: true,
				reasoning: true,
				vision: true,
				tools: true,
				// jsonOutput is left off across every Qianfan mapping until
				// response_format is confirmed against a funded account: an
				// unsupported claim 400s the request, while omitting it only
				// keeps JSON-mode traffic on another provider.
			},
		],
	},
] as const satisfies ModelDefinition[];
