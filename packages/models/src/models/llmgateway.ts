import type { ModelDefinition } from "@/models.js";

export const llmgatewayModels = [
	{
		id: "custom",
		name: "Custom Model",
		description: "Custom model endpoint with user-provided base URL.",
		family: "llmgateway",
		releasedAt: new Date("2024-01-01"),
		providers: [
			{
				providerId: "llmgateway",
				externalId: "custom",
				inputPrice: undefined,
				outputPrice: undefined,
				requestPrice: undefined,
				contextSize: undefined,
				streaming: true,
				vision: true,
				tools: true,
				supportedParameters: [
					"temperature",
					"max_tokens",
					"top_p",
					"frequency_penalty",
					"presence_penalty",
				],
				jsonOutput: true,
			},
		],
	},
	{
		id: "smart",
		name: "Smart Route",
		description:
			"Routes to one of the models your organization configured, chosen by a classifier that rates each request.",
		family: "llmgateway",
		releasedAt: new Date("2026-09-25"),
		providers: [
			{
				providerId: "llmgateway",
				externalId: "smart",
				inputPrice: undefined,
				outputPrice: undefined,
				requestPrice: undefined,
				contextSize: undefined,
				streaming: true,
				vision: true,
				tools: true,
				supportedParameters: [
					"temperature",
					"max_tokens",
					"top_p",
					"frequency_penalty",
					"presence_penalty",
				],
				jsonOutput: true,
			},
		],
	},
	{
		id: "auto",
		name: "Auto Route",
		description: "Automatic model routing based on request characteristics.",
		family: "llmgateway",
		releasedAt: new Date("2024-01-01"),
		providers: [
			{
				providerId: "llmgateway",
				externalId: "auto",
				inputPrice: undefined,
				outputPrice: undefined,
				requestPrice: undefined,
				contextSize: undefined,
				streaming: true,
				vision: true,
				tools: true,
				supportedParameters: [
					"temperature",
					"max_tokens",
					"top_p",
					"frequency_penalty",
					"presence_penalty",
				],
				jsonOutput: true,
			},
		],
	},
] as const satisfies ModelDefinition[];
