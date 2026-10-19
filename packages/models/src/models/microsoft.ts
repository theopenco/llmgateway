import type { ModelDefinition } from "@/models.js";

export const microsoftModels = [
	{
		id: "microsoft-decision-1",
		name: "Microsoft-Decision-1",
		description:
			"Microsoft's small decision model for classification, routing, ranking, grading and binary decisions. Reads text or JSON and returns typed predicate, choice and score answers with probabilities instead of generated text. Served via the /v1/decisions endpoint.",
		family: "microsoft",
		output: ["decision"],
		releasedAt: new Date("2026-10-09"),
		providers: [
			{
				providerId: "azure",
				// Azure calls the decision API with the deployment name, so the
				// Foundry deployment must use this name (the portal default).
				externalId: "Decision-1",
				inputPrice: "0.042e-6",
				outputPrice: "0",
				contextSize: 32768,
				streaming: false,
				tools: false,
				jsonOutput: false,
				decisions: true,
			},
		],
	},
] as const satisfies ModelDefinition[];
