import type { ModelDefinition } from "@/models.js";

const ORPHEUS_ARABIC_SAUDI_VOICES = [
	"fahad",
	"abdullah",
	"sultan",
	"lulwa",
	"noura",
	"aisha",
];

const ORPHEUS_V1_ENGLISH_VOICES = [
	"troy",
	"autumn",
	"diana",
	"hannah",
	"austin",
	"daniel",
];

export const canopylabsModels = [
	{
		id: "orpheus-v1-english",
		name: "Orpheus V1 English",
		description:
			"Canopy Labs' expressive English text-to-speech model with six voices and bracketed vocal directions such as [cheerful] or [whisper]. Generates WAV audio via the /v1/audio/speech endpoint; input is limited to 200 characters per request.",
		family: "canopylabs",
		output: ["audio"],
		releasedAt: new Date("2025-12-19"),
		providers: [
			{
				providerId: "groq",
				externalId: "canopylabs/orpheus-v1-english",
				inputPrice: "0",
				outputPrice: "0",
				inputCharacterPrice: "22e-6",
				requestPrice: "0",
				contextSize: 200,
				streaming: false,
				tools: false,
				jsonOutput: false,
				speechGenerations: true,
				supportedVoices: ORPHEUS_V1_ENGLISH_VOICES,
			},
		],
	},
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
