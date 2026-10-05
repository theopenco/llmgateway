import Clipboard from "@react-native-clipboard/clipboard";
import { useIsFocused } from "@react-navigation/native";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { AppState } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { mintTranscriptionSession } from "@/api/realtime";
import { createMicrophone } from "@/lib/microphone";
import { Transcription } from "@/screens/Transcription";

import type { RealtimeSocket } from "@/lib/transcription-session";

jest.mock("@react-native-clipboard/clipboard", () => ({
	setString: jest.fn(),
}));
jest.mock("@react-navigation/native", () => ({ useIsFocused: jest.fn() }));
jest.mock("@/lib/microphone", () => ({ createMicrophone: jest.fn() }));
jest.mock("@/api/realtime", () => ({ mintTranscriptionSession: jest.fn() }));
jest.mock("@/api/client", () => ({
	api: {
		useQuery: () => ({
			data: {
				favorites: [],
				models: [
					{
						id: "asr",
						name: "Transcription model",
						status: "active",
						output: ["text"],
						mappings: [
							{
								providerId: "openai",
								realtimeTranscription: true,
								realtimeTranscriptionTurnDetection: true,
								status: "active",
							},
							{ providerId: "other", status: "active" },
						],
					},
					{
						id: "voice",
						name: "Voice model",
						status: "active",
						output: ["audio"],
						mappings: [
							{ providerId: "openai", realtime: true, status: "active" },
						],
					},
					{
						id: "gemini",
						name: "Gemini voice",
						status: "active",
						mappings: [
							{
								providerId: "google-ai-studio",
								realtimeTranscription: true,
								status: "active",
							},
						],
					},
				],
			},
		}),
		useMutation: () => ({ mutate: jest.fn() }),
	},
	queryClient: { invalidateQueries: jest.fn() },
}));
const socket: RealtimeSocket = {
	readyState: 1,
	onopen: null,
	onmessage: null,
	onerror: null,
	onclose: null,
	send: jest.fn(),
	close: jest.fn(),
};
const stop = jest.fn();
const originalWebSocket = globalThis.WebSocket;
let audio: (data: string, level: number) => void;
beforeEach(() => {
	jest.clearAllMocks();
	jest.mocked(useIsFocused).mockReturnValue(true);
	jest
		.spyOn(AppState, "addEventListener")
		.mockReturnValue({ remove: jest.fn() });
	stop.mockResolvedValue(undefined);
	jest.mocked(createMicrophone).mockReturnValue({
		start: async (callback) => {
			audio = callback;
		},
		stop,
	});
	jest.mocked(mintTranscriptionSession).mockResolvedValue({
		secret: "ephemeral",
		url: "ws://localhost",
		model: "openai/asr",
	});
	globalThis.WebSocket = jest.fn(() => socket) as unknown as typeof WebSocket;
});
afterEach(() => {
	globalThis.WebSocket = originalWebSocket;
	jest.restoreAllMocks();
});
async function setup() {
	const view = await render(
		<SafeAreaProvider
			initialMetrics={{
				frame: { x: 0, y: 0, width: 400, height: 850 },
				insets: { top: 60, bottom: 30, left: 0, right: 0 },
			}}
		>
			<Transcription projectId="project" />
		</SafeAreaProvider>,
	);
	await fireEvent.press(screen.getByRole("button", { name: "Model: Choose" }));
	expect(screen.queryByRole("button", { name: "Auto route" })).toBeNull();
	expect(
		screen.queryByRole("button", { name: "Choose Voice model" }),
	).toBeNull();
	expect(
		screen.queryByRole("button", { name: "Choose Gemini voice" }),
	).toBeNull();
	await fireEvent.press(
		screen.getByRole("button", { name: "Choose Transcription model" }),
	);
	return view;
}
async function event(type: string, fields: Record<string, unknown> = {}) {
	await act(() =>
		socket.onmessage?.({ data: JSON.stringify({ type, ...fields }) }),
	);
}
async function start() {
	await fireEvent.press(
		screen.getByRole("button", { name: "Start transcription" }),
	);
	await act(() => socket.onopen?.());
	await event("session.created");
	await event("session.updated");
}
test("selects capable providers, uses manual turns, and copies final text", async () => {
	await setup();
	await fireEvent(screen.getByRole("switch"), "valueChange", false);
	await start();
	await act(() => audio("AQACAA==", 0.5));
	await fireEvent.press(
		screen.getByRole("button", { name: "Transcribe turn" }),
	);
	await event("input_audio_buffer.committed", { item_id: "one" });
	await event("conversation.item.input_audio_transcription.completed", {
		item_id: "one",
		transcript: "Welcome to the Lounge.",
	});
	await fireEvent.press(
		screen.getByRole("button", { name: "Stop transcription" }),
	);
	await fireEvent.press(
		screen.getByRole("button", { name: "Copy transcript" }),
	);
	expect(Clipboard.setString).toHaveBeenCalledWith("Welcome to the Lounge.");
	await fireEvent.press(
		screen.getByRole("button", { name: "Clear transcript" }),
	);
	expect(screen.queryByText("Welcome to the Lounge.")).toBeNull();
	expect(stop).toHaveBeenCalledTimes(1);
});
test("Stop now explicitly cancels waiting for the final transcript", async () => {
	await setup();
	await fireEvent(screen.getByRole("switch"), "valueChange", false);
	await start();
	await act(() => audio("AQACAA==", 0.5));
	await fireEvent.press(
		screen.getByRole("button", { name: "Stop transcription" }),
	);
	expect(socket.close).not.toHaveBeenCalled();
	await fireEvent.press(screen.getByRole("button", { name: "Stop now" }));
	expect(socket.close).toHaveBeenCalledTimes(1);
	expect(stop).toHaveBeenCalledTimes(1);
	expect(
		screen.getByRole("button", { name: "Start transcription" }),
	).toBeEnabled();
});

test("backgrounding ends recording without automatically resuming it", async () => {
	await setup();
	await start();
	const listener = jest.mocked(AppState.addEventListener).mock.calls[0][1];
	await act(() => listener("background"));
	expect(stop).toHaveBeenCalledTimes(1);
	await act(() => listener("active"));
	expect(
		screen.getByRole("button", { name: "Start transcription" }),
	).toBeEnabled();
	expect(createMicrophone).toHaveBeenCalledTimes(1);
});

test("shows microphone permission errors with a Settings recovery action", async () => {
	await setup();
	jest.mocked(createMicrophone).mockReturnValue({
		start: async () => {
			throw new Error(
				"Allow microphone access in iOS Settings to transcribe speech.",
			);
		},
		stop,
	});
	await fireEvent.press(
		screen.getByRole("button", { name: "Start transcription" }),
	);
	expect(await screen.findByRole("alert")).toHaveTextContent(
		"Allow microphone access in iOS Settings to transcribe speech.",
	);
	expect(
		screen.getByRole("button", { name: "Open microphone settings" }),
	).toBeVisible();
});

test("copying again is offered when new transcript text arrives", async () => {
	await setup();
	await start();
	await event("conversation.item.input_audio_transcription.completed", {
		item_id: "one",
		transcript: "First turn.",
	});
	await fireEvent.press(
		screen.getByRole("button", { name: "Copy transcript" }),
	);
	expect(
		screen.getByRole("button", { name: "Transcript copied" }),
	).toBeVisible();
	await event("conversation.item.input_audio_transcription.completed", {
		item_id: "two",
		transcript: "Second turn.",
	});
	await fireEvent.press(
		screen.getByRole("button", { name: "Copy transcript" }),
	);
	expect(Clipboard.setString).toHaveBeenLastCalledWith(
		"First turn.\n\nSecond turn.",
	);
	await fireEvent.press(
		screen.getByRole("button", { name: "Stop transcription" }),
	);
});
