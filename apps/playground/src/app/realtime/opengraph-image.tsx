import { loungeOgImage, ogContentType, ogSize } from "@/lib/og";

export const alt = "AI voice calls — realtime speech-to-speech";
export const size = ogSize;
export const contentType = ogContentType;

export default function RealtimeOgImage() {
	return loungeOgImage({
		eyebrow: "Voice",
		title: "Talk to AI in real time",
		subtitle:
			"Live speech-to-speech calls — pick a model and voice, interrupt mid-sentence, and read both transcripts.",
		path: "/realtime",
	});
}
