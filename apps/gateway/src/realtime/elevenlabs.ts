/**
 * ElevenLabs realtime speech-to-text (Scribe Live) connection parameters.
 * The session is configured entirely by query parameters on the upstream
 * WebSocket URL, so the gateway validates the caller's parameters before
 * connecting and forwards only the ones it can meter.
 */

/** Input audio bytes per second for each `audio_format` ElevenLabs accepts. */
const AUDIO_FORMATS: Record<
	string,
	{ sampleRate: number; bytesPerSecond: number }
> = {
	pcm_8000: { sampleRate: 8000, bytesPerSecond: 16_000 },
	pcm_16000: { sampleRate: 16_000, bytesPerSecond: 32_000 },
	pcm_22050: { sampleRate: 22_050, bytesPerSecond: 44_100 },
	pcm_24000: { sampleRate: 24_000, bytesPerSecond: 48_000 },
	pcm_44100: { sampleRate: 44_100, bytesPerSecond: 88_200 },
	pcm_48000: { sampleRate: 48_000, bytesPerSecond: 96_000 },
	ulaw_8000: { sampleRate: 8000, bytesPerSecond: 8000 },
};

export const ELEVENLABS_DEFAULT_AUDIO_FORMAT = "pcm_16000";

type ParamKind = "string" | "list" | "boolean" | "number" | "integer";

const FORWARDED_PARAMS: Record<string, ParamKind | readonly string[]> = {
	audio_format: Object.keys(AUDIO_FORMATS),
	language_code: "string",
	secondary_languages: "list",
	commit_strategy: ["manual", "vad", "turn_prediction"],
	vad_threshold: "number",
	vad_silence_threshold_secs: "number",
	min_speech_duration_ms: "integer",
	min_silence_duration_ms: "integer",
	include_timestamps: "boolean",
	include_language_detection: "boolean",
	no_verbatim: "boolean",
	multilang_mode: "boolean",
	diarize: "boolean",
	filter_background_audio: "boolean",
	keepalive_interval_ms: "integer",
	enable_logging: "boolean",
};

/** Query parameters the gateway itself consumes; never forwarded. */
const GATEWAY_PARAMS = new Set(["model", "intent"]);

/**
 * Add-ons ElevenLabs bills as a per-hour surcharge (or prices separately)
 * that the catalogue does not model, so they are refused instead of
 * under-billed.
 */
const SURCHARGED_PARAMS = new Set([
	"keyterms",
	"transcript_edit",
	"entity_detection",
	"entity_redaction",
	"entity_redaction_mode",
]);

export interface ElevenLabsRealtimeConfig {
	/** Forwarded upstream query, without `model_id`. */
	query: URLSearchParams;
	sampleRate: number;
	bytesPerSecond: number;
}

export type ElevenLabsRealtimeConfigResult =
	| { ok: true; config: ElevenLabsRealtimeConfig }
	| { ok: false; code: string; message: string };

function validValue(
	kind: ParamKind | readonly string[],
	value: string,
): boolean {
	if (typeof kind !== "string") {
		return kind.includes(value);
	}
	switch (kind) {
		case "boolean":
			return value === "true" || value === "false";
		case "number":
			return value.trim() !== "" && Number.isFinite(Number(value));
		case "integer":
			return /^\d+$/.test(value);
		default:
			return value.length > 0 && value.length <= 256;
	}
}

/**
 * Validate the caller's connection query for an ElevenLabs realtime
 * transcription session and build the forwarded upstream query.
 */
export function buildElevenLabsRealtimeConfig(
	params: URLSearchParams,
): ElevenLabsRealtimeConfigResult {
	const query = new URLSearchParams();
	for (const name of new Set(params.keys())) {
		if (GATEWAY_PARAMS.has(name)) {
			continue;
		}
		if (SURCHARGED_PARAMS.has(name)) {
			return {
				ok: false,
				code: "unsupported_parameter",
				message: `Query parameter '${name}' is billed as a separate add-on and is not supported for realtime sessions on LLMGateway.`,
			};
		}
		if (name === "model_id") {
			return {
				ok: false,
				code: "unsupported_parameter",
				message:
					"Select the model with the 'model' query parameter, e.g. model=scribe-v3-live, not 'model_id'.",
			};
		}
		const kind = FORWARDED_PARAMS[name];
		if (kind === undefined) {
			return {
				ok: false,
				code: "unsupported_parameter",
				message: `Unsupported query parameter for ElevenLabs realtime sessions: ${name}`,
			};
		}
		const values = params.getAll(name);
		if (kind !== "list" && values.length > 1) {
			return {
				ok: false,
				code: "invalid_parameter",
				message: `Query parameter '${name}' may only be set once.`,
			};
		}
		for (const value of values) {
			if (!validValue(kind, value)) {
				return {
					ok: false,
					code: "invalid_parameter",
					message: `Invalid value for query parameter '${name}'.`,
				};
			}
			query.append(name, value);
		}
	}
	const audioFormat =
		query.get("audio_format") ?? ELEVENLABS_DEFAULT_AUDIO_FORMAT;
	const format = AUDIO_FORMATS[audioFormat]!;
	return {
		ok: true,
		config: {
			query,
			sampleRate: format.sampleRate,
			bytesPerSecond: format.bytesPerSecond,
		},
	};
}
