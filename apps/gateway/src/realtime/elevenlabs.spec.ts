import { describe, expect, it } from "vitest";

import {
	buildElevenLabsRealtimeQuery,
	buildElevenLabsUpstreamQuery,
	DEFAULT_ELEVENLABS_SESSION_CONFIG,
	elevenLabsAudioRate,
	parseElevenLabsAudioFormat,
	parseElevenLabsTurnDetection,
} from "./elevenlabs.js";

describe("buildElevenLabsRealtimeQuery", () => {
	it("drops gateway parameters and keeps extensions", () => {
		const result = buildElevenLabsRealtimeQuery(
			new URLSearchParams(
				"model=scribe-v3-live&intent=transcription&no_verbatim=true&secondary_languages=de&secondary_languages=fr",
			),
		);
		expect(result.ok && result.query.toString()).toBe(
			"no_verbatim=true&secondary_languages=de&secondary_languages=fr",
		);
	});

	it.each([
		"keyterms",
		"transcript_edit",
		"entity_detection",
		"entity_redaction",
	])("refuses the surcharged %s add-on", (name) => {
		expect(
			buildElevenLabsRealtimeQuery(new URLSearchParams({ [name]: "x" })),
		).toMatchObject({ ok: false, code: "unsupported_parameter" });
	});

	it.each([
		["audio_format=pcm_16000", "unsupported_parameter", "session.update"],
		["commit_strategy=vad", "unsupported_parameter", "session.update"],
		["language_code=en", "unsupported_parameter", "session.update"],
		["diarize=true", "unsupported_parameter", "OpenAI"],
		["include_timestamps=true", "unsupported_parameter", "OpenAI"],
		["model_id=scribe_v3_live", "unsupported_parameter", "model="],
		["unknown=1", "unsupported_parameter", "unknown"],
		["no_verbatim=yes", "invalid_parameter", "no_verbatim"],
		["min_speech_duration_ms=-1", "invalid_parameter", "min_speech"],
		["no_verbatim=true&no_verbatim=false", "invalid_parameter", "once"],
	])("rejects %s", (query, code, hint) => {
		const result = buildElevenLabsRealtimeQuery(new URLSearchParams(query));
		expect(result).toMatchObject({ ok: false, code });
		expect(!result.ok && result.message).toContain(hint);
	});
});

describe("parseElevenLabsAudioFormat", () => {
	it.each([
		[
			{ type: "audio/pcm", rate: 24_000 },
			{ type: "audio/pcm", rate: 24_000 },
		],
		[{ type: "audio/pcm" }, { type: "audio/pcm", rate: 24_000 }],
		[
			{ type: "audio/pcm", rate: 16_000 },
			{ type: "audio/pcm", rate: 16_000 },
		],
		[{ type: "audio/pcmu" }, { type: "audio/pcmu" }],
		["pcm16", { type: "audio/pcm", rate: 24_000 }],
		["g711_ulaw", { type: "audio/pcmu" }],
	])("accepts %j", (input, value) => {
		expect(parseElevenLabsAudioFormat(input)).toEqual({ ok: true, value });
	});

	it.each([
		{ type: "audio/pcma" },
		"g711_alaw",
		{ type: "audio/pcm", rate: 12_345 },
	])("rejects %j", (input) => {
		expect(parseElevenLabsAudioFormat(input)).toMatchObject({
			ok: false,
			code: "unsupported_audio_format",
		});
	});
});

describe("parseElevenLabsTurnDetection", () => {
	it("keeps the VAD settings ElevenLabs supports", () => {
		expect(
			parseElevenLabsTurnDetection({
				type: "server_vad",
				threshold: 0.6,
				silence_duration_ms: 800,
				prefix_padding_ms: 300,
			}),
		).toEqual({
			ok: true,
			value: { type: "server_vad", threshold: 0.6, silence_duration_ms: 800 },
		});
		expect(parseElevenLabsTurnDetection(null)).toEqual({
			ok: true,
			value: null,
		});
	});

	it.each([
		{ type: "server_vad", threshold: 2 },
		{ type: "server_vad", silence_duration_ms: -1 },
		{ type: "other" },
		"server_vad",
	])("rejects %j", (input) => {
		expect(parseElevenLabsTurnDetection(input)).toMatchObject({
			ok: false,
			code: "invalid_turn_detection",
		});
	});
});

describe("buildElevenLabsUpstreamQuery", () => {
	it("maps the OpenAI defaults", () => {
		expect(
			buildElevenLabsUpstreamQuery(
				DEFAULT_ELEVENLABS_SESSION_CONFIG,
				new URLSearchParams("no_verbatim=true"),
			).toString(),
		).toBe("no_verbatim=true&audio_format=pcm_24000&commit_strategy=vad");
	});

	it("maps every configured setting", () => {
		expect(
			buildElevenLabsUpstreamQuery(
				{
					format: { type: "audio/pcmu" },
					language: "en",
					secondaryLanguages: ["de"],
					prompt: "ignored here",
					turnDetection: {
						type: "server_vad",
						threshold: 0.3,
						silence_duration_ms: 1200,
					},
					noiseReduction: { type: "far_field" },
				},
				new URLSearchParams(),
			).toString(),
		).toBe(
			"audio_format=ulaw_8000&language_code=en&secondary_languages=de&commit_strategy=vad&vad_threshold=0.3&vad_silence_threshold_secs=1.2&filter_background_audio=true",
		);
	});

	it.each([
		[null, "manual"],
		[{ type: "semantic_vad" } as const, "turn_prediction"],
	])("maps turn detection %j to %s", (turnDetection, strategy) => {
		expect(
			buildElevenLabsUpstreamQuery(
				{ ...DEFAULT_ELEVENLABS_SESSION_CONFIG, turnDetection },
				new URLSearchParams(),
			).get("commit_strategy"),
		).toBe(strategy);
	});
});

describe("elevenLabsAudioRate", () => {
	it("meters PCM16 and mu-law", () => {
		expect(elevenLabsAudioRate({ type: "audio/pcm", rate: 24_000 })).toEqual({
			sampleRate: 24_000,
			bytesPerSecond: 48_000,
		});
		expect(elevenLabsAudioRate({ type: "audio/pcmu" })).toEqual({
			sampleRate: 8000,
			bytesPerSecond: 8000,
		});
	});
});
