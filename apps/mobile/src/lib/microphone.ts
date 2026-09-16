import { AudioManager, AudioRecorder } from "react-native-audio-api";

import {
	computeRms,
	floatToPcm16Base64,
	REALTIME_SAMPLE_RATE,
	resampleLinear,
	rmsToLevel,
} from "@llmgateway/shared/realtime-pcm";

export interface Microphone {
	start: (
		onAudio: (audio: string, level: number) => void,
		onError: (error: Error) => void,
	) => Promise<void>;
	stop: () => Promise<void>;
}

export function createMicrophone(
	sampleRate = REALTIME_SAMPLE_RATE,
	permissionMessage = "Allow microphone access in iOS Settings to transcribe speech.",
	voiceProcessing = false,
): Microphone {
	const abort = new AbortController();
	let recorder: AudioRecorder | undefined;
	let active = false;
	let recording = false;
	let interruption: ReturnType<typeof AudioManager.addSystemEventListener>;
	let starting: Promise<void> | undefined;
	let stopping: Promise<void> | undefined;
	return {
		start(onAudio, onError) {
			starting = (async () => {
				const permission = await AudioManager.requestRecordingPermissions();
				abort.signal.throwIfAborted();
				if (permission !== "Granted") {
					throw new Error(permissionMessage);
				}
				AudioManager.setAudioSessionOptions({
					iosCategory: "playAndRecord",
					iosMode: "voiceChat",
					iosOptions: ["defaultToSpeaker", "allowBluetoothHFP"],
					iosNotifyOthersOnDeactivation: true,
				});
				await AudioManager.setAudioSessionActivity(true);
				active = true;
				abort.signal.throwIfAborted();
				recorder = new AudioRecorder({ iosVoiceProcessing: voiceProcessing });
				AudioManager.observeAudioInterruptions(true);
				interruption = AudioManager.addSystemEventListener(
					"interruption",
					({ type }) => {
						if (type === "began" && !abort.signal.aborted) {
							onError(
								new Error(
									"Microphone interrupted. Start a new session when you are ready.",
								),
							);
						}
					},
				);
				recorder.onError(({ message }) => onError(new Error(message)));
				const callback = recorder.onAudioReady(
					{
						sampleRate,
						bufferLength: sampleRate / 10,
						channelCount: 1,
					},
					({ buffer, numFrames }) => {
						if (abort.signal.aborted) {
							return;
						}
						const samples = resampleLinear(
							buffer.getChannelData(0).subarray(0, numFrames),
							buffer.sampleRate,
							sampleRate,
						);
						onAudio(
							floatToPcm16Base64(samples),
							rmsToLevel(computeRms(samples)),
						);
					},
				);
				if (callback.status === "error") {
					throw new Error(callback.message);
				}
				const result = await recorder.start();
				if (result.status === "error") {
					throw new Error(result.message);
				}
				recording = true;
				abort.signal.throwIfAborted();
			})();
			return starting;
		},
		stop() {
			abort.abort();
			stopping ??= (async () => {
				// Startup errors are reported by start's caller; cleanup still runs.
				if (starting) {
					await Promise.allSettled([starting]);
				}
				try {
					interruption?.remove();
					if (recorder) {
						recorder.clearOnAudioReady();
						recorder.clearOnError();
						if (recording) {
							const result = await recorder.stop();
							if (result.status === "error") {
								throw new Error(result.message);
							}
						}
					}
				} finally {
					if (active) {
						await AudioManager.setAudioSessionActivity(false);
					}
				}
			})();
			return stopping;
		},
	};
}
