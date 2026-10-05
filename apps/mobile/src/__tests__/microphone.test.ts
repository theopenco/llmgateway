import { AudioManager, AudioRecorder } from "react-native-audio-api";
import { setAudioSessionManagementDisabled } from "react-native-video";

import { createMicrophone } from "@/lib/microphone";

jest.mock("react-native-audio-api", () => ({
	AudioManager: {
		requestRecordingPermissions: jest.fn(),
		setAudioSessionOptions: jest.fn(),
		setAudioSessionActivity: jest.fn(),
		observeAudioInterruptions: jest.fn(),
		addSystemEventListener: jest.fn(),
	},
	AudioRecorder: jest.fn(),
}));
jest.mock("react-native-video", () => ({
	setAudioSessionManagementDisabled: jest.fn(),
}));
const recorder = {
	start: jest.fn(),
	stop: jest.fn(),
	onError: jest.fn(),
	onAudioReady: jest.fn(),
	clearOnAudioReady: jest.fn(),
	clearOnError: jest.fn(),
};
beforeEach(() => {
	jest.resetAllMocks();
	jest
		.mocked(AudioManager.requestRecordingPermissions)
		.mockResolvedValue("Granted");
	jest
		.mocked(AudioManager.setAudioSessionActivity)
		.mockResolvedValue(undefined);
	jest
		.mocked(AudioRecorder)
		.mockReturnValue(recorder as unknown as AudioRecorder);
	recorder.start.mockResolvedValue({ status: "success" });
	recorder.stop.mockResolvedValue({ status: "success" });
	recorder.onAudioReady.mockReturnValue({ status: "success" });
});

test("resamples the actual device rate into mono 24 kHz PCM and releases native resources", async () => {
	const microphone = createMicrophone();
	const audio = jest.fn();
	await microphone.start(audio, jest.fn());
	const callback = recorder.onAudioReady.mock.calls[0][1];
	callback({
		buffer: {
			sampleRate: 48000,
			getChannelData: () => new Float32Array([1, 1, -1, -1]),
		},
	});
	expect(audio).toHaveBeenCalledWith("/38BgA==", 1);
	const stopped = microphone.stop();
	callback({
		buffer: {
			sampleRate: 48000,
			getChannelData: () => new Float32Array([1, 1]),
		},
	});
	await stopped;
	await microphone.stop();
	expect(audio).toHaveBeenCalledTimes(1);
	expect(recorder.stop).toHaveBeenCalledTimes(1);
	expect(recorder.clearOnAudioReady).toHaveBeenCalledTimes(1);
	expect(AudioManager.setAudioSessionActivity).toHaveBeenLastCalledWith(false);
});

test("opts voice calls into echo cancellation and converts device audio to 16 kHz", async () => {
	const microphone = createMicrophone(16000, "Enable microphone access", true);
	const audio = jest.fn();
	await microphone.start(audio, jest.fn());
	expect(AudioRecorder).toHaveBeenCalledWith({ iosVoiceProcessing: true });
	recorder.onAudioReady.mock.calls[0][1]({
		buffer: {
			sampleRate: 48000,
			getChannelData: () => new Float32Array([1, 1, 1, -1, -1, -1]),
		},
		numFrames: 6,
	});
	expect(audio).toHaveBeenCalledWith("/38BgA==", 1);
	await microphone.stop();
});

test("does not activate recording when cancelled while the permission dialog is open", async () => {
	let allow!: (permission: "Granted") => void;
	jest.mocked(AudioManager.requestRecordingPermissions).mockReturnValue(
		new Promise((resolve) => {
			allow = resolve;
		}),
	);
	const microphone = createMicrophone();
	const started = microphone.start(jest.fn(), jest.fn());
	await Promise.resolve();
	const rejected = expect(started).rejects.toThrow();
	const stopped = microphone.stop();
	allow("Granted");
	await rejected;
	await stopped;
	expect(AudioRecorder).not.toHaveBeenCalled();
	expect(AudioManager.setAudioSessionActivity).not.toHaveBeenCalled();
	expect(setAudioSessionManagementDisabled).not.toHaveBeenCalled();
});

test("reports denied permission without creating a recorder", async () => {
	jest
		.mocked(AudioManager.requestRecordingPermissions)
		.mockResolvedValue("Denied");
	const microphone = createMicrophone();
	await expect(microphone.start(jest.fn(), jest.fn())).rejects.toThrow(
		"iOS Settings",
	);
	await microphone.stop();
	expect(AudioRecorder).not.toHaveBeenCalled();
	expect(setAudioSessionManagementDisabled).not.toHaveBeenCalled();
});

test("waits for native startup before stopping and deactivates even if stop fails", async () => {
	let started!: (result: { status: "success" }) => void;
	let nativeStart!: () => void;
	const nativeStarting = new Promise<void>((resolve) => {
		nativeStart = resolve;
	});
	recorder.start.mockImplementation(
		() =>
			new Promise((resolve) => {
				started = resolve;
				nativeStart();
			}),
	);
	const microphone = createMicrophone();
	const startup = microphone.start(jest.fn(), jest.fn());
	await nativeStarting;
	const rejected = expect(startup).rejects.toThrow();
	const cleanup = microphone.stop();
	expect(recorder.stop).not.toHaveBeenCalled();
	recorder.stop.mockResolvedValue({ status: "error", message: "Stop failed" });
	started({ status: "success" });
	await rejected;
	await expect(cleanup).rejects.toThrow("Stop failed");
	expect(AudioManager.setAudioSessionActivity).toHaveBeenLastCalledWith(false);
	expect(setAudioSessionManagementDisabled).toHaveBeenLastCalledWith(false);
});

test("holds the recording session against video route updates until native teardown finishes", async () => {
	let videoManagesSession = true;
	jest
		.mocked(setAudioSessionManagementDisabled)
		.mockImplementation((disabled) => {
			videoManagesSession = !disabled;
		});
	jest
		.mocked(AudioManager.setAudioSessionActivity)
		.mockImplementation(async () => {
			expect(videoManagesSession).toBe(false);
		});
	recorder.start.mockImplementation(async () => {
		expect(videoManagesSession).toBe(false);
		return { status: "success" };
	});
	let release!: (result: { status: "success" }) => void;
	recorder.stop.mockReturnValue(
		new Promise((resolve) => {
			release = resolve;
		}),
	);
	const microphone = createMicrophone();
	await microphone.start(jest.fn(), jest.fn());
	await microphone.start(jest.fn(), jest.fn());
	expect(recorder.start).toHaveBeenCalledTimes(1);
	const stopped = microphone.stop();
	await Promise.resolve();
	expect(videoManagesSession).toBe(false);
	release({ status: "success" });
	await stopped;
	expect(videoManagesSession).toBe(true);
	expect(AudioManager.observeAudioInterruptions).toHaveBeenLastCalledWith(
		false,
	);
});

test("restores video playback after failed session activation", async () => {
	jest
		.mocked(AudioManager.setAudioSessionActivity)
		.mockRejectedValueOnce(new Error("Session unavailable"));
	const microphone = createMicrophone();
	await expect(microphone.start(jest.fn(), jest.fn())).rejects.toThrow(
		"Session unavailable",
	);
	await microphone.stop();
	expect(setAudioSessionManagementDisabled).toHaveBeenNthCalledWith(1, true);
	expect(setAudioSessionManagementDisabled).toHaveBeenNthCalledWith(2, false);
});

test("restores video ownership when the native handoff throws", async () => {
	jest.mocked(setAudioSessionManagementDisabled).mockImplementationOnce(() => {
		throw new Error("Handoff failed");
	});
	const microphone = createMicrophone();
	await expect(microphone.start(jest.fn(), jest.fn())).rejects.toThrow(
		"Handoff failed",
	);
	await microphone.stop();
	expect(AudioRecorder).not.toHaveBeenCalled();
	expect(setAudioSessionManagementDisabled).toHaveBeenNthCalledWith(2, false);
});

test("restores video ownership even when deactivating the audio session fails", async () => {
	const microphone = createMicrophone();
	await microphone.start(jest.fn(), jest.fn());
	jest
		.mocked(AudioManager.setAudioSessionActivity)
		.mockRejectedValueOnce(new Error("Deactivation failed"));
	await expect(microphone.stop()).rejects.toThrow("Deactivation failed");
	expect(setAudioSessionManagementDisabled).toHaveBeenLastCalledWith(false);
	const retry = createMicrophone();
	await retry.start(jest.fn(), jest.fn());
	expect(AudioManager.setAudioSessionActivity).toHaveBeenLastCalledWith(true);
	await retry.stop();
});

test("shows an actionable recording error and restores playback after failed startup", async () => {
	const diagnostic = "NativeAudioRecorder: inputChannels=0";
	const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
	const remove = jest.fn();
	jest
		.mocked(AudioManager.addSystemEventListener)
		.mockReturnValue({ remove } as unknown as ReturnType<
			typeof AudioManager.addSystemEventListener
		>);
	recorder.start.mockResolvedValue({ status: "error", message: diagnostic });
	try {
		const microphone = createMicrophone();
		await expect(microphone.start(jest.fn(), jest.fn())).rejects.toThrow(
			"The microphone could not start. Try again or restart the app.",
		);
		await microphone.stop();
		expect(log).toHaveBeenCalledWith(
			"Could not start the microphone",
			diagnostic,
		);
		expect(recorder.clearOnAudioReady).toHaveBeenCalledTimes(1);
		expect(remove).toHaveBeenCalledTimes(1);
		expect(AudioManager.observeAudioInterruptions).toHaveBeenLastCalledWith(
			false,
		);
		expect(AudioManager.setAudioSessionActivity).toHaveBeenLastCalledWith(
			false,
		);
		expect(setAudioSessionManagementDisabled).toHaveBeenLastCalledWith(false);
	} finally {
		log.mockRestore();
	}
});

test("a reopened recording waits for the previous native stop and deactivation", async () => {
	let finishStop!: (result: { status: "success" }) => void;
	const stopped = new Promise((resolve) => {
		finishStop = resolve;
	});
	recorder.stop.mockReturnValueOnce(stopped);
	const first = createMicrophone();
	const second = createMicrophone();
	await first.start(jest.fn(), jest.fn());
	const stopping = first.stop();
	const starting = second.start(jest.fn(), jest.fn());
	await Promise.resolve();
	await Promise.resolve();
	expect(AudioRecorder).toHaveBeenCalledTimes(1);
	expect(setAudioSessionManagementDisabled).toHaveBeenCalledTimes(1);
	finishStop({ status: "success" });
	await stopping;
	await starting;
	expect(AudioRecorder).toHaveBeenCalledTimes(2);
	expect(jest.mocked(AudioManager.setAudioSessionActivity).mock.calls).toEqual([
		[true],
		[false],
		[true],
	]);
	expect(jest.mocked(setAudioSessionManagementDisabled).mock.calls).toEqual([
		[true],
		[false],
		[true],
	]);
	await second.stop();
});

test("cancelling a queued recording cannot deactivate the next recording", async () => {
	let finishStop!: (result: { status: "success" }) => void;
	const stopped = new Promise((resolve) => {
		finishStop = resolve;
	});
	recorder.stop.mockReturnValueOnce(stopped);
	const first = createMicrophone();
	const cancelled = createMicrophone();
	const next = createMicrophone();
	await first.start(jest.fn(), jest.fn());
	const firstStopping = first.stop();
	const cancelledStart = cancelled.start(jest.fn(), jest.fn());
	const rejected = expect(cancelledStart).rejects.toThrow();
	const cancelledStop = cancelled.stop();
	const nextStart = next.start(jest.fn(), jest.fn());
	finishStop({ status: "success" });
	await firstStopping;
	await rejected;
	await cancelledStop;
	await nextStart;
	expect(AudioRecorder).toHaveBeenCalledTimes(2);
	expect(jest.mocked(AudioManager.setAudioSessionActivity).mock.calls).toEqual([
		[true],
		[false],
		[true],
	]);
	await next.stop();
});
