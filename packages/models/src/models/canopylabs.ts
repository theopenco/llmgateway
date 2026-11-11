import type { ModelDefinition } from "@/models.js";

const ORPHEUS_ARABIC_SAUDI_VOICES = [
	"fahad",
	"abdullah",
	"sultan",
	"lulwa",
	"noura",
	"aisha",
];

export const canopylabsModels = [
	{
		id: "orpheus-arabic-saudi",
		name: "Orpheus Arabic Saudi",
		description:
			"Canopy Labs' Orpheus text-to-speech model for authentic Saudi-dialect Arabic speech with six voices. Generates WAV audio via the /v1/audio/speech endpoint; input is limited to 200 characters per request.",
		family: "canopylabs",
		output: ["audio"],
		releasedAt: new Date("2025-12-16"),
		providers: [
			{
				providerId: "groq",
				externalId: "canopylabs/orpheus-arabic-saudi",
				inputPrice: "0",
				outputPrice: "0",
				inputCharacterPrice: "40e-6",
				requestPrice: "0",
				contextSize: 200,
				streaming: false,
				tools: false,
				jsonOutput: false,
				speechGenerations: true,
				supportedVoices: ORPHEUS_ARABIC_SAUDI_VOICES,
			},
		],
	},
] as const satisfies ModelDefinition[];
