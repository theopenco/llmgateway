import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	act,
	render,
	screen,
	userEvent,
	waitFor,
} from "@testing-library/react-native";
import { AppState } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { client } from "@/api/client";
import { VoiceCallsProvider } from "@/components/VoiceCallsProvider";
import { createMicrophone } from "@/lib/microphone";
import { NativeRealtimePlayback } from "@/lib/realtime-playback";
import { connectRealtime } from "@/lib/realtime-socket";
import { VoiceCalls } from "@/screens/VoiceCalls";

import type { RealtimeSocket } from "@/lib/transcription-session";

jest.mock("@react-navigation/native", () => ({ useIsFocused: () => true }));
jest.mock("@react-native-clipboard/clipboard", () => ({
	setString: jest.fn(),
}));
jest.mock("@/api/client", () => ({
	api: {
		useQuery: (_method: string, path: string) => ({
			data:
				path === "/internal/models"
					? {
							models: [
								{
									id: "voice",
									name: "Voice model",
									status: "active",
									mappings: [
										{
											providerId: "openai",
											realtime: true,
											status: "active",
											supportedVoices: ["alloy"],
										},
									],
								},
							],
						}
					: { items: [], favorites: [] },
		}),
		useMutation: () => ({ mutate: jest.fn() }),
	},
	client: { POST: jest.fn(), PATCH: jest.fn() },
}));
jest.mock("@/api/realtime", () => ({
	...jest.requireActual("@/api/realtime"),
	mintVoiceSession: jest.fn(async () => ({
		model: "openai/voice",
		secret: "ephemeral",
		url: "ws://localhost/realtime",
	})),
}));
jest.mock("@/api/gateway", () => ({ gatewayClient: jest.fn() }));
jest.mock("@/lib/microphone", () => ({ createMicrophone: jest.fn() }));
jest.mock("@/lib/realtime-playback", () => ({
	NativeRealtimePlayback: jest.fn(),
}));
jest.mock("@/lib/realtime-socket", () => ({ connectRealtime: jest.fn() }));
jest.mock("@/components/AudioResult", () => ({ AudioResult: () => null }));

const socket: RealtimeSocket = {
	readyState: 1,
	onopen: null,
	onmessage: null,
	onerror: null,
	onclose: null,
	send: jest.fn(),
	close: jest.fn(),
};
const microphone = {
	start: jest.fn().mockResolvedValue(undefined),
	stop: jest.fn().mockResolvedValue(undefined),
};
const playback = {
	resume: jest.fn().mockResolvedValue(undefined),
	close: jest.fn().mockResolvedValue(undefined),
	enqueue: jest.fn(),
	flush: jest.fn(() => []),
	getLevel: () => 0,
	isPlaying: false,
};
beforeEach(() => {
	jest.clearAllMocks();
	jest.useFakeTimers();
	jest.mocked(createMicrophone).mockReturnValue(microphone);
	jest
		.mocked(NativeRealtimePlayback)
		.mockReturnValue(playback as unknown as NativeRealtimePlayback);
	jest.mocked(connectRealtime).mockReturnValue(socket);
	jest
		.spyOn(AppState, "addEventListener")
		.mockReturnValue({ remove: jest.fn() });
});
afterEach(() => {
	jest.restoreAllMocks();
	jest.useRealTimers();
});

function tree(queries: QueryClient, visible = true) {
	return (
		<SafeAreaProvider
			initialMetrics={{
				frame: { x: 0, y: 0, width: 400, height: 850 },
				insets: { top: 60, bottom: 30, left: 0, right: 0 },
			}}
		>
			<QueryClientProvider client={queries}>
				<VoiceCallsProvider organizationId="organization" projectId="project">
					{visible && <VoiceCalls organizationId="organization" />}
				</VoiceCallsProvider>
			</QueryClientProvider>
		</SafeAreaProvider>
	);
}
async function start() {
	const user = userEvent.setup();
	await user.press(screen.getByRole("button", { name: "Model: Choose" }));
	await user.press(screen.getByRole("button", { name: "Choose Voice model" }));
	await user.press(screen.getByRole("button", { name: "Start voice call" }));
	await act(() => {
		socket.onopen?.();
		socket.onmessage?.({ data: JSON.stringify({ type: "session.created" }) });
		socket.onmessage?.({ data: JSON.stringify({ type: "session.updated" }) });
		socket.onmessage?.({
			data: JSON.stringify({
				type: "conversation.item.input_audio_transcription.completed",
				item_id: "user",
				transcript: "Save this conversation",
			}),
		});
	});
	expect(await screen.findByRole("button", { name: "End call" })).toBeEnabled();
	return user;
}

test("keeps failed saves across navigation and retries without making another call", async () => {
	const queries = new QueryClient({
		defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
	});
	jest
		.mocked(client.POST)
		.mockRejectedValueOnce(new Error("History unavailable"));
	const view = await render(tree(queries));
	const user = await start();
	await view.rerender(tree(queries, false));
	await waitFor(() => expect(client.POST).toHaveBeenCalledTimes(1));
	await view.rerender(tree(queries));
	expect(await screen.findByRole("alert")).toHaveTextContent(
		"History unavailable",
	);
	expect(screen.getByText("Save this conversation")).toBeOnTheScreen();
	expect(
		screen.getByRole("button", { name: "Start voice call" }),
	).toBeDisabled();
	jest.mocked(client.POST).mockResolvedValueOnce({
		data: { item: { id: "saved" } },
		response: new Response(),
	} as Awaited<ReturnType<typeof client.POST>>);
	await user.press(screen.getByRole("button", { name: "Retry saving call" }));
	await waitFor(() =>
		expect(
			queries.getQueryData(["pending-voice-call", "organization"]),
		).toBeNull(),
	);
	expect(microphone.start).toHaveBeenCalledTimes(1);
	expect(microphone.stop).toHaveBeenCalledTimes(1);
	expect(client.POST).toHaveBeenCalledTimes(2);
	await view.unmount();
	queries.clear();
});

test("backgrounding ends a live call and saves its transcript", async () => {
	const queries = new QueryClient();
	jest.mocked(client.POST).mockResolvedValueOnce({
		data: { item: { id: "saved" } },
		response: new Response(),
	} as Awaited<ReturnType<typeof client.POST>>);
	const view = await render(tree(queries));
	await start();
	await act(() =>
		jest.mocked(AppState.addEventListener).mock.calls[0][1]("background"),
	);
	await waitFor(() => expect(client.POST).toHaveBeenCalledTimes(1));
	expect(playback.close).toHaveBeenCalledTimes(1);
	expect(socket.onmessage).toBeNull();
	await view.unmount();
	queries.clear();
});
