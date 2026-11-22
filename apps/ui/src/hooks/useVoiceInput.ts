"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type VoiceState = "idle" | "recording" | "transcribing";

const MAX_RECORDING_MS = 30_000;
const SILENCE_AFTER_SPEECH_MS = 1400;
const SPEECH_LEVEL = 0.045;
const SILENCE_LEVEL = 0.02;
const LEVEL_INTERVAL_MS = 60;
const LEVEL_HISTORY = 36;
const MIME_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];

function toBase64(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onerror = () =>
			reject(reader.error ?? new Error("Could not read the recording"));
		reader.onload = () => {
			const result = typeof reader.result === "string" ? reader.result : "";
			resolve(result.slice(result.indexOf(",") + 1));
		};
		reader.readAsDataURL(blob);
	});
}

/**
 * Push-to-talk: records the microphone, stops on its own once the speaker
 * goes quiet, and hands the recording to `transcribe`.
 */
export function useVoiceInput({
	transcribe,
	onTranscript,
	onError,
}: {
	transcribe: (audio: string, mimeType: string) => Promise<string>;
	onTranscript: (text: string) => void;
	onError: (message: string) => void;
}) {
	const [state, setState] = useState<VoiceState>("idle");
	const [levels, setLevels] = useState<number[]>([]);
	const session = useRef<{ stop: () => void; discard: () => void } | null>(
		null,
	);
	const handlers = useRef({ transcribe, onTranscript, onError });
	useEffect(() => {
		handlers.current = { transcribe, onTranscript, onError };
	});

	const supported =
		typeof window !== "undefined" &&
		typeof MediaRecorder !== "undefined" &&
		!!navigator.mediaDevices?.getUserMedia;

	const start = useCallback(async () => {
		if (session.current) {
			return;
		}
		let stream: MediaStream;
		try {
			stream = await navigator.mediaDevices.getUserMedia({ audio: true });
		} catch {
			handlers.current.onError(
				"Microphone access is blocked. Allow it in your browser to talk.",
			);
			return;
		}
		const mimeType = MIME_TYPES.find((type) =>
			MediaRecorder.isTypeSupported(type),
		);
		const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
		const chunks: Blob[] = [];
		const audioContext = new AudioContext();
		const analyser = audioContext.createAnalyser();
		analyser.fftSize = 512;
		audioContext.createMediaStreamSource(stream).connect(analyser);
		const samples = new Float32Array(analyser.fftSize);

		let discarded = false;
		let heardSpeech = false;
		let quietSince = 0;
		const startedAt = Date.now();
		const meter = window.setInterval(() => {
			analyser.getFloatTimeDomainData(samples);
			let sum = 0;
			samples.forEach((sample) => {
				sum += sample * sample;
			});
			const rms = Math.sqrt(sum / samples.length);
			setLevels((previous) => [
				...previous.slice(1 - LEVEL_HISTORY),
				Math.min(1, rms * 6),
			]);
			const now = Date.now();
			if (rms > SPEECH_LEVEL) {
				heardSpeech = true;
				quietSince = 0;
			} else if (heardSpeech && rms < SILENCE_LEVEL) {
				quietSince ||= now;
			}
			if (
				now - startedAt > MAX_RECORDING_MS ||
				(quietSince && now - quietSince > SILENCE_AFTER_SPEECH_MS)
			) {
				recorder.stop();
			}
		}, LEVEL_INTERVAL_MS);

		recorder.ondataavailable = (event) => {
			if (event.data.size > 0) {
				chunks.push(event.data);
			}
		};
		recorder.onstop = () => {
			window.clearInterval(meter);
			for (const track of stream.getTracks()) {
				track.stop();
			}
			void audioContext.close();
			session.current = null;
			setLevels([]);
			if (discarded || chunks.length === 0) {
				setState("idle");
				return;
			}
			setState("transcribing");
			const blob = new Blob(chunks, { type: recorder.mimeType });
			toBase64(blob)
				.then((audio) => handlers.current.transcribe(audio, blob.type))
				.then((text) => {
					if (text) {
						handlers.current.onTranscript(text);
					} else {
						handlers.current.onError("I didn't catch that. Try again.");
					}
				})
				.catch((error: unknown) => {
					handlers.current.onError(
						error instanceof Error && error.message
							? error.message
							: "Could not transcribe the recording.",
					);
				})
				.finally(() => setState("idle"));
		};

		session.current = {
			stop: () => {
				if (recorder.state !== "inactive") {
					recorder.stop();
				}
			},
			discard: () => {
				discarded = true;
				if (recorder.state !== "inactive") {
					recorder.stop();
				}
			},
		};
		recorder.start();
		setState("recording");
	}, []);

	const stop = useCallback(() => session.current?.stop(), []);

	useEffect(() => () => session.current?.discard(), []);

	return { state, levels, supported, start, stop };
}
