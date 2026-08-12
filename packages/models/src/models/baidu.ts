import type { ModelDefinition } from "@/models.js";

export const baiduModels = [
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
