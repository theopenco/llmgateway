import { useIsFocused } from "@react-navigation/native";
import { act, render, screen, userEvent } from "@testing-library/react-native";
import { AppState } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { mintTranscriptionSession } from "@/api/realtime";
import { DictationSheet } from "@/components/DictationSheet";
import { createMicrophone } from "@/lib/microphone";
import { connectRealtime } from "@/lib/realtime-socket";

import type { RealtimeSocket } from "@/lib/transcription-session";

jest.mock("@react-navigation/native", () => ({ useIsFocused: jest.fn() }));
jest.mock("@/lib/microphone", () => ({ createMicrophone: jest.fn() }));
jest.mock("@/lib/realtime-socket", () => ({ connectRealtime: jest.fn() }));
jest.mock("@/api/realtime", () => ({ mintTranscriptionSession: jest.fn() }));
jest.mock("@/api/client", () => ({
	api: {
		useQuery: () => ({
			data: {
				favorites: [],
				models: [
					{
						id: "inactive-asr",
						status: "inactive",
						mappings: [
							{
								providerId: "provider",
								realtimeTranscription: true,
								status: "active",
							},
						],
					},
					{
						id: "asr",
						name: "Transcription model",
						status: "active",
						output: ["text"],
						mappings: [
							{
								providerId: "google-ai-studio",
								realtimeTranscription: true,
								status: "active",
							},
							{
								providerId: "disabled",
								realtimeTranscription: true,
								status: "inactive",
							},
							{
								providerId: "expired",
								realtimeTranscription: true,
								status: "active",
								deactivatedAt: "2000-01-01",
							},
							{
								providerId: "provider",
								realtimeTranscription: true,
								status: "active",
								region: "eu",
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

let socket: RealtimeSocket;
let audio: (data: string, level: number) => void;
const stop = jest.fn();
const onInsert = jest.fn();
const onClose = jest.fn();

beforeEach(() => {
	jest.useFakeTimers();
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
		url: "ws://localhost/realtime",
		model: "provider/asr:eu",
	});
	socket = {
		readyState: 1,
		onopen: null,
		onmessage: null,
		onerror: null,
		onclose: null,
		send: jest.fn(),
		close: jest.fn(),
	};
	jest.mocked(connectRealtime).mockReturnValue(socket);
});

afterEach(() => {
	jest.restoreAllMocks();
	jest.clearAllTimers();
	jest.useRealTimers();
});

async function setup() {
	const view = await render(
		<SafeAreaProvider
			initialMetrics={{
				frame: { x: 0, y: 0, width: 400, height: 850 },
				insets: { top: 60, bottom: 30, left: 0, right: 0 },
			}}
		>
			<DictationSheet
				projectId="project"
				onInsert={onInsert}
				onClose={onClose}
			/>
		</SafeAreaProvider>,
	);
	return { ...view, user: userEvent.setup() };
}

async function event(type: string, fields: Record<string, unknown> = {}) {
	await act(() =>
		socket.onmessage?.({ data: JSON.stringify({ type, ...fields }) }),
	);
}

async function connect() {
	await act(() => socket.onopen?.());
	await event("session.created");
	await event("session.updated");
}

test("chooses an active mapping and inserts only the final dictated text", async () => {
	const { user } = await setup();
	expect(mintTranscriptionSession).toHaveBeenCalledWith(
		"project",
		"provider/asr:eu",
		expect.any(AbortSignal),
	);
	await connect();
	await act(() => audio("AQACAA==", 0.7));
	await user.press(screen.getByRole("button", { name: "Done" }));
	expect(stop).toHaveBeenCalledTimes(1);
	expect(onInsert).not.toHaveBeenCalled();
	expect(screen.getByText("Turning speech into text…")).toBeOnTheScreen();
	await event("input_audio_buffer.committed", { item_id: "one" });
	await event("conversation.item.input_audio_transcription.delta", {
		item_id: "one",
		delta: "Draft",
	});
	expect(onInsert).not.toHaveBeenCalled();
	await event("conversation.item.input_audio_transcription.completed", {
		item_id: "one",
		transcript: "Draft this message.",
	});
	expect(onInsert).toHaveBeenCalledTimes(1);
	expect(onInsert).toHaveBeenCalledWith("Draft this message.");
	expect(onClose).toHaveBeenCalledTimes(1);
});

test("cancelling discards dictation and releases the microphone", async () => {
	const { user } = await setup();
	await connect();
	await act(() => audio("AQACAA==", 0.7));
	await user.press(screen.getByRole("button", { name: "Cancel dictation" }));
	expect(stop).toHaveBeenCalledTimes(1);
	expect(socket.close).toHaveBeenCalledTimes(1);
	expect(onClose).toHaveBeenCalledTimes(1);
	expect(onInsert).not.toHaveBeenCalled();
});

test("a microphone failure offers retry without reopening or losing the draft", async () => {
	jest.mocked(createMicrophone).mockReturnValueOnce({
		start: async () => {
			throw new Error("The microphone could not start.");
		},
		stop,
	});
	const { user } = await setup();
	expect(await screen.findByRole("alert")).toHaveTextContent(
		"The microphone could not start.",
	);
	await user.press(screen.getByRole("button", { name: "Try again" }));
	await connect();
	expect(screen.getByText("Listening…")).toBeOnTheScreen();
	expect(createMicrophone).toHaveBeenCalledTimes(2);
	expect(onInsert).not.toHaveBeenCalled();
	expect(onClose).not.toHaveBeenCalled();
});

test("keeps a failed partial transcript for explicit recovery", async () => {
	const { user } = await setup();
	await connect();
	await act(() => audio("AQACAA==", 0.7));
	await user.press(screen.getByRole("button", { name: "Done" }));
	await event("input_audio_buffer.committed", { item_id: "one" });
	await event("conversation.item.input_audio_transcription.delta", {
		item_id: "one",
		delta: "A partial thought",
	});
	await event("conversation.item.input_audio_transcription.failed", {
		item_id: "one",
		error: { message: "Transcription interrupted" },
	});
	expect(onInsert).not.toHaveBeenCalled();
	await user.press(screen.getByRole("button", { name: "Use text" }));
	expect(onInsert).toHaveBeenCalledWith("A partial thought");
});

test("backgrounding dismisses dictation without adding text", async () => {
	await setup();
	await connect();
	const listener = jest.mocked(AppState.addEventListener).mock.calls[0][1];
	await act(() => listener("background"));
	expect(stop).toHaveBeenCalledTimes(1);
	expect(onClose).toHaveBeenCalledTimes(1);
	expect(onInsert).not.toHaveBeenCalled();
});
