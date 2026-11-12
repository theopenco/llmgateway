export interface TranscriptionOptions {
	language?: string;
	diarize: boolean;
	fillerWords: boolean;
	keyterms: string[];
	url?: string;
	file?: File;
}

const UPSTREAM_PATHS: Partial<Record<string, string>> = {
	xai: "/v1/stt",
	elevenlabs: "/v1/speech-to-text",
};

export function getTranscriptionUpstreamPath(providerId: string): string {
	const path = UPSTREAM_PATHS[providerId];
	if (!path) {
		throw new Error(`Unsupported transcription provider: ${providerId}`);
	}
	return path;
}

/**
 * Request fields a provider cannot serve at the mapping's catalogue price.
 * ElevenLabs bills keyterm prompting as a per-hour surcharge the catalogue
 * does not model, so keyterms are refused instead of under-billed.
 */
export function getUnsupportedTranscriptionParam(
	providerId: string,
	options: TranscriptionOptions,
): string | null {
	if (providerId === "elevenlabs" && options.keyterms.length > 0) {
		return "keyterm";
	}
	return null;
}

export function buildTranscriptionForm(
	providerId: string,
	upstreamModel: string,
	options: TranscriptionOptions,
): FormData {
	const form = new FormData();
	const { language, diarize, fillerWords, keyterms, url, file } = options;
	if (providerId === "elevenlabs") {
		form.append("model_id", upstreamModel);
		if (language) {
			form.append("language_code", language);
		}
		if (diarize) {
			form.append("diarize", "true");
		}
		// Scribe keeps filler words by default; the gateway's default drops them.
		if (!fillerWords) {
			form.append("no_verbatim", "true");
		}
		if (url) {
			form.append("source_url", url);
		} else if (file) {
			form.append("file", file, file.name || "audio");
		}
		return form;
	}

	// Option fields must precede the file in the multipart body — the upstream
	// xAI /v1/stt endpoint ignores fields sent after `file` on streamed uploads.
	if (language) {
		form.append("format", "true");
		form.append("language", language);
	}
	if (diarize) {
		form.append("diarize", "true");
	}
	if (fillerWords) {
		form.append("filler_words", "true");
	}
	for (const term of keyterms) {
		form.append("keyterm", term);
	}
	if (url) {
		form.append("url", url);
	} else if (file) {
		form.append("file", file, file.name || "audio");
	}
	return form;
}

function finiteNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

/**
 * Map an ElevenLabs Scribe response onto the gateway's transcription shape
 * (`text`, `language`, `duration`, `words`). Spacing tokens are dropped and
 * `speaker_N` ids become numeric `speaker` values.
 */
function normalizeElevenLabsTranscription(
	body: Record<string, unknown>,
): Record<string, unknown> {
	const rawWords = Array.isArray(body.words) ? body.words : [];
	const words = rawWords.flatMap((entry: unknown) => {
		if (!entry || typeof entry !== "object") {
			return [];
		}
		const word = entry as Record<string, unknown>;
		if (word.type === "spacing" || typeof word.text !== "string") {
			return [];
		}
		const speakerMatch =
			typeof word.speaker_id === "string"
				? /^speaker_(\d+)$/.exec(word.speaker_id)
				: null;
		return [
			{
				text: word.text,
				start: finiteNumber(word.start),
				end: finiteNumber(word.end),
				...(word.type === "audio_event" ? { type: "audio_event" } : {}),
				...(speakerMatch ? { speaker: Number(speakerMatch[1]) } : {}),
			},
		];
	});
	return {
		text: typeof body.text === "string" ? body.text : "",
		language:
			typeof body.language_code === "string" ? body.language_code : undefined,
		duration: finiteNumber(body.audio_duration_secs),
		words,
	};
}

export function normalizeTranscriptionResponse(
	providerId: string,
	body: Record<string, unknown>,
): Record<string, unknown> {
	return providerId === "elevenlabs"
		? normalizeElevenLabsTranscription(body)
		: body;
}
