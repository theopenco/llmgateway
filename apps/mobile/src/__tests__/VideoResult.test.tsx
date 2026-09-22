import {
	QueryClient,
	QueryClientProvider,
	useQuery,
} from "@tanstack/react-query";
import {
	act,
	render,
	screen,
	userEvent,
	waitFor,
} from "@testing-library/react-native";
import { useVideoPlayer } from "react-native-video";

import { api } from "@/api/client";
import { VideoResult } from "@/components/VideoResult";

import type { UseQueryOptions } from "@tanstack/react-query";
import type { VideoPlayer } from "react-native-video";

jest.mock("@react-navigation/native", () => ({ useIsFocused: () => true }));
jest.mock("@/api/client", () => ({ api: { useQuery: jest.fn() } }));
jest.mock("@/lib/export-file", () => ({ exportRemoteFile: jest.fn() }));
jest.mock("react-native-video", () => ({
	useVideoPlayer: jest.fn(),
	useEvent: jest.fn(),
	VideoView: () => null,
}));

const mockQuery = {
	data: {
		status: "completed",
		progress: 100,
		content: [{ url: "https://example.com/video.mp4" }],
	},
	isPending: false,
	isFetching: false,
	refetch: jest.fn(),
};
const query = api.useQuery as jest.Mock<unknown, unknown[]>;
interface VideoJob {
	status:
		"queued" | "in_progress" | "completed" | "failed" | "canceled" | "expired";
	progress: number;
	content?: { url: string }[];
	error?: { message: string } | null;
}
function poll(fetchJob: () => Promise<VideoJob>) {
	query.mockImplementation(function useVideoQuery(...args: unknown[]) {
		return useQuery({
			...(args[3] as UseQueryOptions<VideoJob>),
			queryKey: ["video", "job"],
			queryFn: fetchJob,
		});
	});
}
const player = {
	status: "readyToPlay",
	duration: 4,
	pause: jest.fn(),
	play: jest.fn(),
	seekTo: jest.fn(),
};

beforeEach(() => {
	jest.useFakeTimers();
	jest.clearAllMocks();
	query.mockReturnValue(mockQuery);
	jest.mocked(useVideoPlayer).mockReturnValue(player as unknown as VideoPlayer);
	mockQuery.refetch.mockResolvedValue({ data: mockQuery.data });
});

afterEach(() => {
	jest.clearAllTimers();
	jest.useRealTimers();
});

async function setup() {
	await render(
		<QueryClientProvider
			client={
				new QueryClient({ defaultOptions: { mutations: { retry: false } } })
			}
		>
			<VideoResult
				result={{
					modelId: "video",
					modelName: "Video model",
					jobId: "job",
					videoUrl: null,
				}}
			/>
		</QueryClientProvider>,
	);
	return userEvent.setup();
}

test("refresh retries failed playback even when the content URL is unchanged", async () => {
	const user = await setup();
	player.play.mockImplementationOnce(() => {
		throw new Error("Playback failed");
	});
	await user.press(screen.getByRole("button", { name: "Play" }));
	expect(screen.getByRole("button", { name: "Play" })).toBeDisabled();
	await user.press(screen.getByRole("button", { name: "Refresh video" }));
	await waitFor(() =>
		expect(screen.getByRole("button", { name: "Play" })).toBeEnabled(),
	);
	expect(mockQuery.refetch).toHaveBeenCalledWith({ throwOnError: true });
	await user.press(screen.getByRole("button", { name: "Play" }));
	expect(player.play).toHaveBeenCalledTimes(2);
});

test("reports refresh failures and keeps the existing playback available", async () => {
	const user = await setup();
	mockQuery.refetch.mockRejectedValueOnce(new Error("Connection unavailable"));
	await user.press(screen.getByRole("button", { name: "Refresh video" }));
	expect(await screen.findByRole("alert")).toHaveTextContent(
		"Connection unavailable",
	);
	expect(screen.getByRole("button", { name: "Play" })).toBeEnabled();
});

test("polls completed jobs until playback is ready without a manual refresh", async () => {
	const fetchJob = jest
		.fn<Promise<VideoJob>, []>()
		.mockResolvedValueOnce({ status: "queued", progress: 0 })
		.mockResolvedValueOnce({ status: "completed", progress: 100 })
		.mockResolvedValue({
			status: "completed",
			progress: 100,
			content: [{ url: "https://example.com/ready.mp4" }],
		});
	poll(fetchJob);
	await setup();
	await waitFor(() =>
		expect(screen.getByText("queued · 0%")).toBeOnTheScreen(),
	);
	await act(() => jest.advanceTimersByTimeAsync(3000));
	await waitFor(() =>
		expect(screen.getByText("Preparing playback…")).toBeOnTheScreen(),
	);
	expect(screen.queryByRole("button", { name: "Play" })).toBeNull();
	await act(() => jest.advanceTimersByTimeAsync(3000));
	await waitFor(() =>
		expect(screen.getByRole("button", { name: "Play" })).toBeEnabled(),
	);
	expect(screen.queryByText("Preparing playback…")).toBeNull();
	await act(() => jest.advanceTimersByTimeAsync(9000));
	expect(fetchJob).toHaveBeenCalledTimes(3);
});

test.each<VideoJob>([
	{ status: "failed", progress: 100 },
	{ status: "canceled", progress: 100 },
	{ status: "expired", progress: 100 },
	{
		status: "completed",
		progress: 100,
		error: { message: "Video unavailable" },
	},
])("does not keep polling a terminal job: %j", async (job) => {
	const fetchJob = jest.fn<Promise<VideoJob>, []>().mockResolvedValue(job);
	poll(fetchJob);
	await setup();
	await waitFor(() =>
		expect(screen.getByText(`${job.status} · 100%`)).toBeOnTheScreen(),
	);
	if (job.error) {
		expect(screen.getByRole("alert")).toHaveTextContent(job.error.message);
	}
	expect(screen.queryByText("Preparing playback…")).toBeNull();
	await act(() => jest.advanceTimersByTimeAsync(9000));
	expect(fetchJob).toHaveBeenCalledTimes(1);
});
