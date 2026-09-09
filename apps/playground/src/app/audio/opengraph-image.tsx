import { loungeOgImage, ogContentType, ogSize } from "@/lib/og";

export const alt = "AI text to speech — ElevenLabs, OpenAI, and Gemini voices";
export const size = ogSize;
export const contentType = ogContentType;

export default function AudioStudioOgImage() {
	return loungeOgImage({
		eyebrow: "Audio studio",
		title: "Text to speech with every major voice model",
		subtitle:
			"ElevenLabs, OpenAI, and Gemini TTS — pick a voice, compare providers, and download the audio.",
		path: "/audio",
	});
}
