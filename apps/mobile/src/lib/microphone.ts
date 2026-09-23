import { AudioManager, AudioRecorder } from "react-native-audio-api";
import { setAudioSessionManagementDisabled } from "react-native-video";

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

let microphoneReleased = Promise.resolve();

export function createMicrophone(
	sampleRate = REALTIME_SAMPLE_RATE,
	permissionMessage = "Allow microphone access in iOS Settings to transcribe speech.",
	voiceProcessing = false,
): Microphone {
	const abort = new AbortController();
	let recorder: AudioRecorder | undefined;
	let active = false;
	let ownsSession = false;
	let recording = false;
	let interruption: ReturnType<typeof AudioManager.addSystemEventListener>;
	let starting: Promise<void> | undefined;
	let stopping: Promise<void> | undefined;
	let releaseOwnership: (() => void) | undefined;
	return {
		start(onAudio, onError) {
			if (starting) {
				return starting;
			}
			if (abort.signal.aborted) {
				return Promise.reject(new Error("The microphone session has ended."));
			}
			// A dismissed screen can still be releasing the shared native audio session.
			const previous = microphoneReleased;
			microphoneReleased = new Promise((resolve) => {
				releaseOwnership = resolve;
			});
			starting = (async () => {
				await previous;
				abort.signal.throwIfAborted();
				const permission = await AudioManager.requestRecordingPermissions();
				abort.signal.throwIfAborted();
				if (permission !== "Granted") {
					throw new Error(permissionMessage);
				}
				// Video's global route observer otherwise switches recording back to playback.
				ownsSession = true;
				setAudioSessionManagementDisabled(true);
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
					// eslint-disable-next-line no-console -- Keep native diagnostics out of the recording UI.
					console.error("Could not start the microphone", result.message);
					throw new Error(
						"The microphone could not start. Try again or restart the app.",
					);
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
					if (ownsSession) {
						AudioManager.observeAudioInterruptions(false);
					}
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
					try {
						if (active) {
							await AudioManager.setAudioSessionActivity(false);
						}
					} finally {
						if (ownsSession) {
							setAudioSessionManagementDisabled(false);
							ownsSession = false;
						}
					}
				}
			})().finally(() => releaseOwnership?.());
			return stopping;
		},
	};
}
