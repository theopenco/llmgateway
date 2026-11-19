/**
 * ElevenLabs realtime speech-to-text (Scribe Live) translated to the OpenAI
 * realtime transcription protocol. ElevenLabs configures a session entirely
 * by query parameters on the upstream WebSocket URL, so the gateway keeps the
 * OpenAI session config itself and derives the upstream query from it when
 * it opens the upstream connection.
 */

type ParamKind = "list" | "boolean" | "integer";

/** Optional ElevenLabs-only connection parameters accepted on the gateway URL. */
const EXTENSION_PARAMS: Record<string, ParamKind> = {
	secondary_languages: "list",
	no_verbatim: "boolean",
	multilang_mode: "boolean",
	min_speech_duration_ms: "integer",
	min_silence_duration_ms: "integer",
	keepalive_interval_ms: "integer",
	enable_logging: "boolean",
};

/** Ranges ElevenLabs enforces on integer parameters. */
const INTEGER_RANGES: Record<string, [number, number]> = {
	min_speech_duration_ms: [50, 2000],
	min_silence_duration_ms: [50, 2000],
	keepalive_interval_ms: [500, 10_000],
};

/** ElevenLabs' VAD ranges; OpenAI values outside them are clamped. */
const VAD_THRESHOLD_RANGE: [number, number] = [0.1, 0.9];
const VAD_SILENCE_MS_RANGE: [number, number] = [192, 3000];

function clamp(value: number, [min, max]: [number, number]): number {
	return Math.min(max, Math.max(min, value));
}

/** Native parameters the OpenAI session config sets instead. */
const SESSION_UPDATE_PARAMS: Record<string, string> = {
	audio_format: "audio.input.format",
	language_code: "audio.input.transcription.language",
	commit_strategy: "audio.input.turn_detection",
	vad_threshold: "audio.input.turn_detection.threshold",
	vad_silence_threshold_secs: "audio.input.turn_detection.silence_duration_ms",
	filter_background_audio: "audio.input.noise_reduction",
};

/** Native parameters whose events have no OpenAI realtime equivalent. */
const NON_OPENAI_EVENT_PARAMS = new Set([
	"include_timestamps",
	"include_language_detection",
	"diarize",
]);

/** Query parameters the gateway itself consumes; never forwarded. */
const GATEWAY_PARAMS = new Set([
	"model",
	"intent",
	"safety_identifier",
	"user",
]);

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

/** PCM sample rates ElevenLabs accepts for `audio/pcm` input. */
const PCM_RATES = new Set([8000, 16_000, 22_050, 24_000, 44_100, 48_000]);

export type ElevenLabsAudioFormat =
	{ type: "audio/pcm"; rate: number } | { type: "audio/pcmu" };

export type ElevenLabsTurnDetection =
	| {
			type: "server_vad";
			threshold?: number;
			silence_duration_ms?: number;
	  }
	| { type: "semantic_vad" }
	| null;

/** The OpenAI transcription settings an ElevenLabs session runs with. */
export interface ElevenLabsSessionConfig {
	format: ElevenLabsAudioFormat;
	language: string | null;
	/** Extra languages from the `languages` list, after the first. */
	secondaryLanguages: string[];
	prompt: string;
	turnDetection: ElevenLabsTurnDetection;
	noiseReduction: Record<string, unknown> | null;
}

export const DEFAULT_ELEVENLABS_SESSION_CONFIG: ElevenLabsSessionConfig = {
	format: { type: "audio/pcm", rate: 24_000 },
	language: null,
	secondaryLanguages: [],
	prompt: "",
	turnDetection: { type: "server_vad" },
	noiseReduction: null,
};

export type ElevenLabsRealtimeQueryResult =
	| { ok: true; query: URLSearchParams }
	| { ok: false; code: string; message: string };

export type ParseResult<T> =
	{ ok: true; value: T } | { ok: false; code: string; message: string };

function validValue(kind: ParamKind, value: string): boolean {
	switch (kind) {
		case "boolean":
			return value === "true" || value === "false";
		case "integer":
			return /^\d+$/.test(value);
		default:
			return value.length > 0 && value.length <= 256;
	}
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Validate the ElevenLabs-only extension parameters on the caller's
 * connection URL. Everything the OpenAI session config covers is set with
 * `session.update` instead.
 */
export function buildElevenLabsRealtimeQuery(
	params: URLSearchParams,
): ElevenLabsRealtimeQueryResult {
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
		const sessionField = SESSION_UPDATE_PARAMS[name];
		if (sessionField !== undefined) {
			return {
				ok: false,
				code: "unsupported_parameter",
				message: `Query parameter '${name}' is not supported; set session.${sessionField} with session.update.`,
			};
		}
		if (NON_OPENAI_EVENT_PARAMS.has(name)) {
			return {
				ok: false,
				code: "unsupported_parameter",
				message: `Query parameter '${name}' is not supported: its events have no OpenAI realtime equivalent.`,
			};
		}
		const kind = EXTENSION_PARAMS[name];
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
		const range = INTEGER_RANGES[name];
		for (const value of values) {
			if (
				!validValue(kind, value) ||
				(range && (Number(value) < range[0] || Number(value) > range[1]))
			) {
				return {
					ok: false,
					code: "invalid_parameter",
					message: range
						? `Query parameter '${name}' must be between ${range[0]} and ${range[1]}.`
						: `Invalid value for query parameter '${name}'.`,
				};
			}
			query.append(name, value);
		}
	}
	return { ok: true, query };
}

/**
 * Parse an OpenAI audio input format: the GA object form or the legacy
 * `input_audio_format` string.
 */
export function parseElevenLabsAudioFormat(
	value: unknown,
): ParseResult<ElevenLabsAudioFormat> {
	if (value === "pcm16") {
		return { ok: true, value: { type: "audio/pcm", rate: 24_000 } };
	}
	if (value === "g711_ulaw") {
		return { ok: true, value: { type: "audio/pcmu" } };
	}
	if (isPlainObject(value)) {
		if (value.type === "audio/pcm") {
			const rate = value.rate ?? 24_000;
			if (typeof rate === "number" && PCM_RATES.has(rate)) {
				return { ok: true, value: { type: "audio/pcm", rate } };
			}
			return {
				ok: false,
				code: "unsupported_audio_format",
				message: `audio/pcm rate must be one of ${[...PCM_RATES].join(", ")}.`,
			};
		}
		if (value.type === "audio/pcmu") {
			return { ok: true, value: { type: "audio/pcmu" } };
		}
	}
	return {
		ok: false,
		code: "unsupported_audio_format",
		message:
			"ElevenLabs realtime transcription supports audio/pcm and audio/pcmu input.",
	};
}

/**
 * Parse an OpenAI `turn_detection` config. Values outside ElevenLabs' VAD
 * ranges are clamped, and the session reports the values in effect.
 */
export function parseElevenLabsTurnDetection(
	value: unknown,
): ParseResult<ElevenLabsTurnDetection> {
	if (value === null) {
		return { ok: true, value: null };
	}
	if (isPlainObject(value)) {
		if (value.type === "semantic_vad") {
			return { ok: true, value: { type: "semantic_vad" } };
		}
		if (value.type === "server_vad") {
			const { threshold, silence_duration_ms: silence } = value;
			if (
				threshold !== undefined &&
				threshold !== null &&
				(typeof threshold !== "number" || threshold < 0 || threshold > 1)
			) {
				return {
					ok: false,
					code: "invalid_turn_detection",
					message: "turn_detection.threshold must be a number from 0 to 1.",
				};
			}
			if (
				silence !== undefined &&
				silence !== null &&
				(typeof silence !== "number" ||
					!Number.isInteger(silence) ||
					silence < 0)
			) {
				return {
					ok: false,
					code: "invalid_turn_detection",
					message:
						"turn_detection.silence_duration_ms must be a non-negative integer.",
				};
			}
			return {
				ok: true,
				value: {
					type: "server_vad",
					...(typeof threshold === "number" && {
						threshold: clamp(threshold, VAD_THRESHOLD_RANGE),
					}),
					...(typeof silence === "number" && {
						silence_duration_ms: clamp(silence, VAD_SILENCE_MS_RANGE),
					}),
				},
			};
		}
	}
	return {
		ok: false,
		code: "invalid_turn_detection",
		message: "turn_detection must be null, server_vad or semantic_vad.",
	};
}

/** Input audio sample rate and bytes per second for a format. */
export function elevenLabsAudioRate(format: ElevenLabsAudioFormat): {
	sampleRate: number;
	bytesPerSecond: number;
} {
	return format.type === "audio/pcmu"
		? { sampleRate: 8000, bytesPerSecond: 8000 }
		: { sampleRate: format.rate, bytesPerSecond: format.rate * 2 };
}

/** The upstream query for a session config plus the caller's extensions. */
export function buildElevenLabsUpstreamQuery(
	config: ElevenLabsSessionConfig,
	extensions: URLSearchParams,
): URLSearchParams {
	const query = new URLSearchParams(extensions);
	query.set(
		"audio_format",
		config.format.type === "audio/pcmu"
			? "ulaw_8000"
			: `pcm_${config.format.rate}`,
	);
	if (config.language) {
		query.set("language_code", config.language);
	}
	for (const language of config.secondaryLanguages) {
		query.append("secondary_languages", language);
	}
	const { turnDetection } = config;
	query.set(
		"commit_strategy",
		turnDetection === null
			? "manual"
			: turnDetection.type === "semantic_vad"
				? "turn_prediction"
				: "vad",
	);
	if (turnDetection?.type === "server_vad") {
		if (turnDetection.threshold !== undefined) {
			query.set("vad_threshold", String(turnDetection.threshold));
		}
		if (turnDetection.silence_duration_ms !== undefined) {
			query.set(
				"vad_silence_threshold_secs",
				String(turnDetection.silence_duration_ms / 1000),
			);
		}
	}
	if (config.noiseReduction !== null) {
		query.set("filter_background_audio", "true");
	}
	return query;
}
