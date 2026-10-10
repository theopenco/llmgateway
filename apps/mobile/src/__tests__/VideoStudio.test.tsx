import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	render,
	screen,
	userEvent,
	waitFor,
} from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { client } from "@/api/client";
import { createVideo } from "@/api/videos";
import { VideoStudio } from "@/screens/VideoStudio";

jest.mock("@/api/client", () => ({
	api: {
		useQuery: () => ({
			data: {
				items: [],
				favorites: [],
				models: [
					{
						id: "video-model",
						name: "Video model",
						status: "active",
						output: ["video"],
						mappings: [
							{
								modelId: "video-model",
								providerId: "provider",
								region: null,
								status: "active",
								deactivatedAt: null,
								supportedVideoSizes: ["1280x720"],
								supportedVideoDurationsSeconds: [8],
							},
						],
					},
				],
			},
		}),
		useMutation: () => ({ mutate: jest.fn() }),
	},
	client: { POST: jest.fn() },
	queryClient: { invalidateQueries: jest.fn() },
}));
jest.mock("@/api/videos", () => ({ createVideo: jest.fn() }));
jest.mock("@/components/VideoResult", () => ({ VideoResult: () => null }));
jest.mock("@/lib/files", () => ({ pickFile: jest.fn() }));
jest.useFakeTimers();

test("retries saving a queued job without starting another billable generation", async () => {
	jest.mocked(createVideo).mockResolvedValue({
		modelId: "video-model",
		modelName: "Video model",
		jobId: "job",
		videoUrl: null,
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
				<VideoStudio organizationId="organization" projectId="project" />
			</QueryClientProvider>
		</SafeAreaProvider>,
	);
	const user = userEvent.setup();
	await user.press(
		screen.getByRole("button", { name: "Video model 1: Choose" }),
	);
	expect(screen.queryByRole("button", { name: "Auto route" })).toBeNull();
	await user.press(screen.getByRole("button", { name: "Choose Video model" }));
	await user.type(screen.getByLabelText("Video prompt"), "A tree");
	await user.press(screen.getByRole("button", { name: "Generate video" }));
	expect(await screen.findByRole("alert")).toHaveTextContent(
		"History unavailable",
	);
	expect(screen.getByRole("button", { name: "Generate video" })).toBeDisabled();
	await user.press(
		screen.getByRole("button", { name: "Retry saving video jobs" }),
	);
	await waitFor(() =>
		expect(
			screen.getByRole("button", { name: "Generate video" }),
		).toBeEnabled(),
	);
	expect(createVideo).toHaveBeenCalledTimes(1);
	expect(client.POST).toHaveBeenLastCalledWith("/playground/video-history", {
		body: expect.objectContaining({
			models: [expect.objectContaining({ jobId: "job" })],
		}),
	});
});
