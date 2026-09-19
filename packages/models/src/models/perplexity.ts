import type { ModelDefinition } from "@/models.js";

export const perplexityModels = [
	{
		id: "sonar-reasoning-pro",
		name: "Sonar Reasoning Pro",
		description: "Perplexity's advanced reasoning model with web search.",
		family: "perplexity",
		releasedAt: new Date("2025-03-07"),
		providers: [
			{
				providerId: "perplexity",
				externalId: "sonar-reasoning-pro",
				inputPrice: "2e-6",
				outputPrice: "8e-6",
				requestPrice: "5.0e-3",
				imageInputPrice: "0",
				contextSize: 128000,
				maxOutput: undefined,
				streaming: true,
				vision: false,
				tools: false,
				test: "skip",
				jsonOutput: false,
				jsonOutputSchema: true,
				// Perplexity retires Sonar chat/completions on this date and the
				// Agent API rejects this model id outright with "model ... is not
				// supported", so there is nothing to migrate it to.
				deactivatedAt: new Date("2026-09-27"),
			},
		],
	},
	{
		id: "sonar-pro",
		name: "Sonar Pro",
		description: "Professional Sonar model with enhanced search capabilities.",
		family: "perplexity",
		releasedAt: new Date("2025-03-07"),
		providers: [
			{
				providerId: "perplexity",
				externalId: "sonar-pro",
				inputPrice: "3e-6",
				outputPrice: "15e-6",
				requestPrice: "5.0e-3",
				imageInputPrice: "0",
				contextSize: 200000,
				maxOutput: undefined,
				streaming: true,
				vision: false,
				tools: false,
				test: "skip",
				jsonOutput: false,
				jsonOutputSchema: true,
				// See sonar-reasoning-pro: the Agent API has no equivalent model id.
				deactivatedAt: new Date("2026-09-27"),
			},
		],
	},
	{
		id: "sonar",
		name: "Sonar",
		description: "Standard Sonar model for search-augmented generation.",
		family: "perplexity",
		releasedAt: new Date("2025-01-01"),
		providers: [
			{
				providerId: "perplexity",
				externalId: "perplexity/sonar",
				usesPerplexityAgentApi: true,
				inputPrice: "0.25e-6",
				outputPrice: "2.5e-6",
				cachedInputPrice: "0.0625e-6",
				cacheWriteInputPrice: "0.25e-6",
				webSearch: true,
				webSearchPrice: "0.0025",
				imageInputPrice: "0",
				contextSize: 130000,
				maxOutput: undefined,
				streaming: true,
				vision: false,
				tools: false,
				test: "skip",
				jsonOutput: false,
				jsonOutputSchema: true,
			},
		],
	},
] as const satisfies ModelDefinition[];
