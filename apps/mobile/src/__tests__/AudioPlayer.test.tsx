import { useIsFocused } from "@react-navigation/native";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { AppState } from "react-native";
import { AudioContext, useAudioTagContext } from "react-native-audio-api";

import { AudioPlayer } from "@/components/AudioPlayer";

import type { ReactNode } from "react";

jest.mock("@react-navigation/native", () => ({ useIsFocused: jest.fn() }));
jest.mock("react-native-audio-api", () => ({
	Audio: ({ children }: { children: ReactNode }) => children,
	AudioContext: jest.fn(() => ({
		close: jest.fn().mockResolvedValue(undefined),
	})),
	useAudioTagContext: jest.fn(),
}));

const playback = {
	play: jest.fn(),
	pause: jest.fn(),
	seekToTime: jest.fn(),
	setVolume: jest.fn(),
	setMuted: jest.fn(),
	ready: true,
	volume: 1,
	muted: false,
	playbackState: "idle" as const,
	currentTime: 0,
	duration: 25,
	autoPlay: false,
	loop: false,
	preload: "auto" as const,
	playbackRate: 1,
	preservesPitch: true,
};

beforeEach(() => {
	jest.clearAllMocks();
	jest
		.spyOn(AppState, "addEventListener")
		.mockReturnValue({ remove: jest.fn() });
	jest.mocked(useIsFocused).mockReturnValue(true);
	jest.mocked(useAudioTagContext).mockReturnValue(playback);
});

afterEach(() => jest.restoreAllMocks());

test("replays finished audio from the start and clamps seeks", async () => {
	jest
		.mocked(useAudioTagContext)
		.mockReturnValue({ ...playback, currentTime: 25 });
	const view = await render(<AudioPlayer uri="file:///audio.wav" />);
	await fireEvent.press(screen.getByRole("button", { name: "Replay" }));
	expect(playback.seekToTime).toHaveBeenCalledWith(0);
	expect(playback.play).toHaveBeenCalledTimes(1);
	await fireEvent.press(
		screen.getByRole("button", { name: "Forward 10 seconds" }),
	);
	expect(playback.seekToTime).toHaveBeenLastCalledWith(25);
	jest
		.mocked(useAudioTagContext)
		.mockReturnValue({ ...playback, currentTime: 3 });
	await view.rerender(<AudioPlayer uri="file:///audio.wav" />);
	await fireEvent.press(
		screen.getByRole("button", { name: "Back 10 seconds" }),
	);
	expect(playback.seekToTime).toHaveBeenLastCalledWith(0);
});

test("pauses when navigating away or backgrounding and releases its listener", async () => {
	const remove = jest.fn();
	const listener = jest
		.spyOn(AppState, "addEventListener")
		.mockReturnValue({ remove });
	const view = await render(<AudioPlayer uri="file:///audio.wav" />);
	await act(() => listener.mock.calls[0][1]("background"));
	expect(playback.pause).toHaveBeenCalledTimes(1);
	jest.mocked(useIsFocused).mockReturnValue(false);
	await view.rerender(<AudioPlayer uri="file:///audio.wav" />);
	expect(playback.pause).toHaveBeenCalledTimes(2);
	expect(screen.getByRole("button", { name: "Play" })).toBeDisabled();
	await view.unmount();
	expect(remove).toHaveBeenCalledTimes(1);
	expect(
		jest.mocked(AudioContext).mock.results[0].value.close,
	).toHaveBeenCalledTimes(1);
});

test("shows asynchronous playback failures", async () => {
	playback.play.mockRejectedValueOnce(new Error("Audio decoder failed"));
	await render(<AudioPlayer uri="file:///audio.opus" />);
	await fireEvent.press(screen.getByRole("button", { name: "Play" }));
	expect(await screen.findByRole("alert")).toHaveTextContent(
		"Audio decoder failed",
	);
	expect(screen.getByRole("button", { name: "Play" })).toBeDisabled();
});
