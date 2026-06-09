import type { ModelDefinition } from "@/models.js";

/**
 * Built-in ElevenLabs voices, mapped from a friendly name to the upstream
 * voice id used in the `/v1/text-to-speech/{voice_id}` path. The first entry
 * ("Sarah") is the default when the caller omits `voice`; it is a "premade"
 * voice available on every plan tier (including free), so the default never
 * fails for an arbitrary key. "Aria" and "Charlotte" are library voices that
 * require a paid ElevenLabs subscription, so they are offered but not the
 * default. The gateway resolves the friendly name to the id at request time,
 * and also accepts a raw voice id directly.
 */
export const ELEVENLABS_VOICE_IDS: Record<string, string> = {
	Sarah: "EXAVITQu4vr4xnSDxMaL",
	Aria: "9BWtsMINqrJLrRacOk9x",
	Roger: "CwhRBWXzGAHq8TQ4Fs17",
	Laura: "FGY2WhTYpPnrIDTdsKH5",
	Charlie: "IKne3meq5aSn9XLyUdCD",
	George: "JBFqnCBsd6RMkjVDRZzb",
	Callum: "N2lVS1w4EtoT3dr4eOWO",
	River: "SAz9YHcvj6GT2YYXdXww",
	Liam: "TX3LPaxmHKxFdv7VOQHJ",
	Charlotte: "XB0fDUnXU5powFXDhCwa",
	Alice: "Xb7hH8MSUJpSbSDYk0k2",
	Matilda: "XrExE9yKIg1WjnnlVkGX",
	Will: "bIHbv24MWmeRgasZH58o",
	Jessica: "cgSgspJ2msm6clMCkdW9",
	Eric: "cjVigY5qzO86Huf0OWal",
	Chris: "iP95p4xoKVk53GoZ742B",
	Brian: "nPczCjzI2devNBz1zQrb",
	Daniel: "onwK4e9ZLuTAKqWW03F9",
	Lily: "pFZP5JQG7iQjIQuC4Bku",
	Bill: "pqHfZKP75CvOlQylNhV4",
};

const ELEVENLABS_VOICES = Object.keys(ELEVENLABS_VOICE_IDS);

export const elevenlabsModels = [
	{
		id: "eleven-multilingual-v2",
		name: "Eleven Multilingual v2",
		description:
			"ElevenLabs' most lifelike text-to-speech model with rich emotional expression across 29 languages. Generates speech via the /v1/audio/speech endpoint.",
		family: "elevenlabs",
		output: ["audio"],
		releasedAt: new Date("2023-08-22"),
		providers: [
			{
				providerId: "elevenlabs",
				externalId: "eleven_multilingual_v2",
				inputPrice: "0",
				outputPrice: "0",
				// Billed per input character. ElevenLabs bills full-rate (1 credit
				// per character) for the multilingual/v3 models; published API rates
				// land around $0.11 per 1,000 characters.
				inputCharacterPrice: "110e-6",
				requestPrice: "0",
				contextSize: 10000,
				streaming: false,
				tools: false,
				jsonOutput: false,
				speechGenerations: true,
				supportedVoices: ELEVENLABS_VOICES,
			},
		],
	},
	{
		id: "eleven-v3",
		name: "Eleven v3",
		description:
			"ElevenLabs' most expressive, human-like text-to-speech model supporting 70+ languages. Generates speech via the /v1/audio/speech endpoint.",
		family: "elevenlabs",
		output: ["audio"],
		releasedAt: new Date("2025-06-05"),
		providers: [
			{
				providerId: "elevenlabs",
				externalId: "eleven_v3",
				inputPrice: "0",
				outputPrice: "0",
				inputCharacterPrice: "110e-6",
				requestPrice: "0",
				contextSize: 5000,
				streaming: false,
				tools: false,
				jsonOutput: false,
				speechGenerations: true,
				supportedVoices: ELEVENLABS_VOICES,
			},
		],
	},
	{
		id: "eleven-flash-v2-5",
		name: "Eleven Flash v2.5",
		description:
			"Ultra-fast, low-latency ElevenLabs text-to-speech model optimized for real-time use across 32 languages. Generates speech via the /v1/audio/speech endpoint.",
		family: "elevenlabs",
		output: ["audio"],
		releasedAt: new Date("2024-12-03"),
		providers: [
			{
				providerId: "elevenlabs",
				externalId: "eleven_flash_v2_5",
				inputPrice: "0",
				outputPrice: "0",
				// Flash/Turbo bill at the discounted half-credit rate (~$0.055 per
				// 1,000 characters).
				inputCharacterPrice: "55e-6",
				requestPrice: "0",
				contextSize: 40000,
				streaming: false,
				tools: false,
				jsonOutput: false,
				speechGenerations: true,
				supportedVoices: ELEVENLABS_VOICES,
			},
		],
	},
	{
		id: "eleven-turbo-v2-5",
		name: "Eleven Turbo v2.5",
		description:
			"Fast, balanced ElevenLabs text-to-speech model with low latency across 32 languages. Generates speech via the /v1/audio/speech endpoint.",
		family: "elevenlabs",
		output: ["audio"],
		releasedAt: new Date("2024-07-18"),
		providers: [
			{
				providerId: "elevenlabs",
				externalId: "eleven_turbo_v2_5",
				inputPrice: "0",
				outputPrice: "0",
				inputCharacterPrice: "55e-6",
				requestPrice: "0",
				contextSize: 40000,
				streaming: false,
				tools: false,
				jsonOutput: false,
				speechGenerations: true,
				supportedVoices: ELEVENLABS_VOICES,
			},
		],
	},
] as const satisfies ModelDefinition[];
