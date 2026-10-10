import type { ModelDefinition } from "@/models.js";

export const typesafeModels = [
	{
		id: "jev-1.13.0",
		name: "Jev 1.13",
		aliases: ["jev", "jev-latest", "jev-preview"],
		description:
			"TypeSafe's System One decision model. Takes a state plus named typed questions and returns calibrated yes/no, choice and score answers with probabilities instead of generated text. Served via the /v1/systemone endpoint.",
		family: "typesafe",
		output: ["decision"],
		releasedAt: new Date("2026-09-15"),
		providers: [
			{
				providerId: "typesafe",
				externalId: "jev-1.13.0",
				inputPrice: "0.042e-6",
				outputPrice: "0",
				contextSize: 64000,
				streaming: false,
				tools: false,
				jsonOutput: false,
				decisions: true,
			},
		],
	},
] as const satisfies ModelDefinition[];
