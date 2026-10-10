import type { GeneratedAudio } from "@llmgateway/shared/audio-generation-config";

export * from "@llmgateway/shared/audio-generation-config";

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
