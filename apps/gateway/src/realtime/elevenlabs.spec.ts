import { describe, expect, it } from "vitest";

import { buildElevenLabsRealtimeConfig } from "./elevenlabs.js";

describe("buildElevenLabsRealtimeConfig", () => {
	it("defaults to 16 kHz PCM and drops gateway parameters", () => {
		const result = buildElevenLabsRealtimeConfig(
			new URLSearchParams({ model: "scribe-v3-live", intent: "transcription" }),
		);
		expect(result).toEqual({
			ok: true,
			config: {
				query: new URLSearchParams(),
				sampleRate: 16_000,
				bytesPerSecond: 32_000,
			},
		});
	});

	it("forwards supported session parameters", () => {
		const params = new URLSearchParams(
			"model=scribe-v3-live&audio_format=ulaw_8000&commit_strategy=turn_prediction&diarize=true&vad_threshold=0.4&secondary_languages=de&secondary_languages=fr",
		);
		const result = buildElevenLabsRealtimeConfig(params);
		expect(result.ok).toBe(true);
		if (!result.ok) {
			return;
		}
		expect(result.config.query.toString()).toBe(
			"audio_format=ulaw_8000&commit_strategy=turn_prediction&diarize=true&vad_threshold=0.4&secondary_languages=de&secondary_languages=fr",
		);
		expect(result.config.bytesPerSecond).toBe(8000);
		expect(result.config.sampleRate).toBe(8000);
	});

	it.each([
		"keyterms",
		"transcript_edit",
		"entity_detection",
		"entity_redaction",
	])("refuses the surcharged %s add-on", (name) => {
		const result = buildElevenLabsRealtimeConfig(
			new URLSearchParams({ [name]: "x" }),
		);
		expect(result).toMatchObject({ ok: false, code: "unsupported_parameter" });
	});

	it.each([
		["model_id=scribe_v2_realtime", "unsupported_parameter"],
		["unknown=1", "unsupported_parameter"],
		["audio_format=mp3", "invalid_parameter"],
		["diarize=yes", "invalid_parameter"],
		["min_speech_duration_ms=-1", "invalid_parameter"],
		["vad_threshold=abc", "invalid_parameter"],
		["diarize=true&diarize=false", "invalid_parameter"],
	])("rejects %s", (query, code) => {
		expect(
			buildElevenLabsRealtimeConfig(new URLSearchParams(query)),
		).toMatchObject({ ok: false, code });
	});
});
