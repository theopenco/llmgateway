import { AudioManager, AudioRecorder } from "react-native-audio-api";

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
	const rejected = expect(started).rejects.toThrow();
	const stopped = microphone.stop();
	allow("Granted");
	await rejected;
	await stopped;
	expect(AudioRecorder).not.toHaveBeenCalled();
	expect(AudioManager.setAudioSessionActivity).not.toHaveBeenCalled();
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
});

test("waits for native startup before stopping and deactivates even if stop fails", async () => {
	let started!: (result: { status: "success" }) => void;
	recorder.start.mockReturnValue(
		new Promise((resolve) => {
			started = resolve;
		}),
	);
	const microphone = createMicrophone();
	const startup = microphone.start(jest.fn(), jest.fn());
	await Promise.resolve();
	await Promise.resolve();
	const rejected = expect(startup).rejects.toThrow();
	const cleanup = microphone.stop();
	expect(recorder.stop).not.toHaveBeenCalled();
	recorder.stop.mockResolvedValue({ status: "error", message: "Stop failed" });
	started({ status: "success" });
	await rejected;
	await expect(cleanup).rejects.toThrow("Stop failed");
	expect(AudioManager.setAudioSessionActivity).toHaveBeenLastCalledWith(false);
});
