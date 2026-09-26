import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	render,
	screen,
	userEvent,
	waitFor,
} from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { generateSpeech } from "@/api/audio";
import { client } from "@/api/client";
import { AudioStudio } from "@/screens/AudioStudio";

jest.mock("@/api/client", () => ({
	api: {
		useQuery: () => ({
			data: {
				items: [],
				favorites: [],
				models: [
					{
						id: "tts-1",
						name: "Speech model",
						status: "active",
						output: ["audio"],
						mappings: [{ speechGenerations: true, status: "active" }],
					},
					{
						id: "realtime-model",
						name: "Realtime model",
						status: "active",
						output: ["text", "audio"],
						mappings: [{ realtime: true, status: "active" }],
					},
				],
			},
		}),
		useMutation: () => ({ mutate: jest.fn() }),
	},
	client: { POST: jest.fn() },
	queryClient: { invalidateQueries: jest.fn() },
}));
jest.mock("@/api/audio", () => ({
	defaultAudioSettings: () => ({
		voice: "alloy",
		format: "wav",
		speed: 1,
		instructions: "",
	}),
	generateSpeech: jest.fn(),
}));
jest.mock("@/components/AudioResult", () => ({ AudioResult: () => null }));
jest.useFakeTimers();

test("retains speech when saving history fails and retries without regenerating", async () => {
	jest.mocked(generateSpeech).mockResolvedValue({
		modelId: "tts-1",
		modelName: "Speech model",
		audio: { base64: "YXVkaW8=", mediaType: "audio/wav" },
	});
	jest
		.mocked(client.POST)
		.mockRejectedValueOnce(new Error("History unavailable"))
		.mockResolvedValueOnce({ data: undefined, response: new Response() });
	await render(
		<SafeAreaProvider
			initialMetrics={{
				frame: { x: 0, y: 0, width: 400, height: 850 },
				insets: { top: 60, bottom: 30, left: 0, right: 0 },
			}}
		>
			<QueryClientProvider
				client={
					new QueryClient({ defaultOptions: { mutations: { retry: false } } })
				}
			>
				<AudioStudio organizationId="organization" projectId="project" />
			</QueryClientProvider>
		</SafeAreaProvider>,
	);
	const user = userEvent.setup();
	await user.press(
		screen.getByRole("button", { name: "Audio model 1: Choose" }),
	);
	expect(screen.queryByRole("button", { name: "Auto route" })).toBeNull();
	expect(
		screen.queryByRole("button", { name: "Choose Realtime model" }),
	).toBeNull();
	await user.press(screen.getByRole("button", { name: "Choose Speech model" }));
	await user.type(
		screen.getByLabelText("Words to speak"),
		"Welcome to the Lounge",
	);
	await user.press(screen.getByRole("button", { name: "Generate speech" }));
	expect(await screen.findByRole("alert")).toHaveTextContent(
		"History unavailable",
	);
	expect(
		screen.getByRole("button", { name: "Generate speech" }),
	).toBeDisabled();
	await user.press(screen.getByRole("button", { name: "Retry saving audio" }));
	await waitFor(() =>
		expect(
			screen.getByRole("button", { name: "Generate speech" }),
		).toBeEnabled(),
	);
	expect(generateSpeech).toHaveBeenCalledTimes(1);
	expect(client.POST).toHaveBeenLastCalledWith("/playground/audio-history", {
		body: expect.objectContaining({
			models: [
				expect.objectContaining({
					audio: { base64: "YXVkaW8=", mediaType: "audio/wav" },
				}),
			],
		}),
	});
});
