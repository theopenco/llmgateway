export interface GeneratedAudio {
	base64: string;
	mediaType: string;
}

export interface AudioGalleryItem {
	id: string;
	prompt: string;
	timestamp: number;
	// Organization context active when the generation was started. Captured up
	// front so the saved item is attributed to the right org even if the user
	// switches organizations while the generation is in flight.
	organizationId?: string;
	voice?: string;
	models: {
		modelId: string;
		modelName: string;
		audio: GeneratedAudio | null;
		error?: string;
		isLoading: boolean;
	}[];
}

export type AudioFormat = "mp3" | "wav" | "opus" | "aac" | "flac";

// Voice catalogs mirror the `supportedVoices` lists in the static model
// definitions (packages/models). They are duplicated here so the client bundle
// doesn't pull in the full models package; the gateway validates voices
// against the canonical list at request time.
const OPENAI_TTS_VOICES = [
	"alloy",
	"ash",
	"coral",
	"echo",
	"fable",
	"nova",
	"onyx",
	"sage",
	"shimmer",
];

const OPENAI_GPT4O_MINI_TTS_VOICES = [
	"alloy",
	"ash",
	"ballad",
	"cedar",
	"coral",
	"echo",
	"fable",
	"marin",
	"nova",
	"onyx",
	"sage",
	"shimmer",
	"verse",
];

const GEMINI_TTS_VOICES = [
	"Kore",
	"Puck",
	"Zephyr",
	"Charon",
	"Fenrir",
	"Leda",
	"Orus",
	"Aoede",
	"Callirrhoe",
	"Autonoe",
	"Enceladus",
	"Iapetus",
	"Umbriel",
	"Algieba",
	"Despina",
	"Erinome",
	"Algenib",
	"Rasalgethi",
	"Laomedeia",
	"Achernar",
	"Alnilam",
	"Schedar",
	"Gacrux",
	"Pulcherrima",
	"Achird",
	"Zubenelgenubi",
	"Vindemiatrix",
	"Sadachbia",
	"Sadaltager",
	"Sulafat",
];

const ELEVENLABS_VOICES = [
	"Sarah",
	"Aria",
	"Roger",
	"Laura",
	"Charlie",
	"George",
	"Callum",
	"River",
	"Liam",
	"Charlotte",
	"Alice",
	"Matilda",
	"Will",
	"Jessica",
	"Eric",
	"Chris",
	"Brian",
	"Daniel",
	"Lily",
	"Bill",
];

export interface AudioModelConfig {
	voices: string[];
	defaultVoice: string;
	availableFormats: AudioFormat[];
	defaultFormat: AudioFormat;
	supportsSpeed: boolean;
	availableSpeeds: number[];
	supportsInstructions: boolean;
}

export function getModelAudioConfig(model: string): AudioModelConfig {
	const lower = model.toLowerCase();

	if (lower.includes("eleven")) {
		return {
			voices: ELEVENLABS_VOICES,
			defaultVoice: "Sarah",
			// ElevenLabs also supports raw PCM, but the browser can't play it in
			// an <audio> element, so it is not offered in the studio.
			availableFormats: ["mp3", "wav", "opus"],
			defaultFormat: "mp3",
			supportsSpeed: true,
			// ElevenLabs voice_settings.speed accepts 0.7–1.2.
			availableSpeeds: [0.75, 0.9, 1, 1.1, 1.2],
			supportsInstructions: false,
		};
	}

	if (lower.includes("gemini")) {
		return {
			voices: GEMINI_TTS_VOICES,
			defaultVoice: "Kore",
			// Gemini emits raw PCM; the gateway can only return it as WAV (or PCM,
			// which the browser can't play).
			availableFormats: ["wav"],
			defaultFormat: "wav",
			supportsSpeed: false,
			availableSpeeds: [],
			supportsInstructions: true,
		};
	}

	const isGpt4oMiniTts = lower.includes("gpt-4o-mini-tts");

	return {
		voices: isGpt4oMiniTts ? OPENAI_GPT4O_MINI_TTS_VOICES : OPENAI_TTS_VOICES,
		defaultVoice: "alloy",
		availableFormats: ["mp3", "wav", "opus", "aac", "flac"],
		defaultFormat: "mp3",
		supportsSpeed: true,
		availableSpeeds: [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4],
		// Only gpt-4o-mini-tts accepts delivery instructions; tts-1/tts-1-hd
		// reject them.
		supportsInstructions: isGpt4oMiniTts,
	};
}

export function downloadAudio(audio: GeneratedAudio, filename?: string) {
	const dataUrl = `data:${audio.mediaType};base64,${audio.base64}`;
	const ext = audio.mediaType.split("/")[1]?.split(";")[0] ?? "mp3";
	const name =
		filename ?? `audio-${Date.now()}.${ext === "mpeg" ? "mp3" : ext}`;
	const a = document.createElement("a");
	a.href = dataUrl;
	a.download = name;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
}
