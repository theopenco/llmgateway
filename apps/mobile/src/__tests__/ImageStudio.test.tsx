import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	render,
	screen,
	userEvent,
	waitFor,
} from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { client } from "@/api/client";
import { generateImages } from "@/api/images";
import { ImageStudio } from "@/screens/ImageStudio";

jest.mock("@/api/client", () => ({
	api: {
		useQuery: () => ({ data: { items: [] } }),
		useMutation: () => ({ mutate: jest.fn() }),
	},
	client: { POST: jest.fn() },
	queryClient: { invalidateQueries: jest.fn() },
}));
jest.mock("@/api/images", () => ({
	defaultImageSettings: () => ({
		model: "auto",
		size: "1K",
		quality: "low",
		moderation: "auto",
		aspectRatio: "auto",
	}),
	generateImages: jest.fn(),
}));
jest.mock("@/components/ImageOptions", () => ({ ImageOptions: () => null }));
jest.mock("@/lib/files", () => ({ pickFile: jest.fn() }));
jest.mock("@/lib/export-image", () => ({ exportImage: jest.fn() }));
jest.useFakeTimers();

beforeEach(() => jest.clearAllMocks());

async function renderStudio() {
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
				<ImageStudio organizationId="organization" projectId="project" />
			</QueryClientProvider>
		</SafeAreaProvider>,
	);
}

test("keeps generated images when history fails and retries saving without regenerating", async () => {
	jest.mocked(generateImages).mockResolvedValue({
		modelId: "auto",
		modelName: "Auto",
		images: [{ base64: "fixture", mediaType: "image/png" }],
	});
	jest
		.mocked(client.POST)
		.mockRejectedValueOnce(new Error("History unavailable"))
		.mockResolvedValueOnce({ data: undefined, response: new Response() });
	await renderStudio();
	const user = userEvent.setup();
	await user.type(screen.getByLabelText("Image prompt"), "A tree");
	await user.press(screen.getByRole("button", { name: "Generate image" }));
	expect(await screen.findByRole("alert")).toHaveTextContent(
		"History unavailable",
	);
	expect(screen.getByLabelText("Generated image 1.1")).toBeOnTheScreen();
	expect(screen.getByRole("button", { name: "Generate image" })).toBeDisabled();
	await user.press(
		screen.getByRole("button", { name: "Retry saving history" }),
	);
	await waitFor(() =>
		expect(
			screen.getByRole("button", { name: "Generate image" }),
		).toBeEnabled(),
	);
	expect(generateImages).toHaveBeenCalledTimes(1);
	expect(client.POST).toHaveBeenCalledTimes(2);
});

test("preserves successful comparison images when another model fails", async () => {
	jest
		.mocked(generateImages)
		.mockResolvedValueOnce({
			modelId: "auto",
			modelName: "Auto",
			images: [{ base64: "fixture", mediaType: "image/png" }],
		})
		.mockRejectedValueOnce(new Error("Model unavailable"));
	jest
		.mocked(client.POST)
		.mockResolvedValue({ data: undefined, response: new Response() });
	await renderStudio();
	const user = userEvent.setup();
	await user.press(
		screen.getByRole("button", { name: "Compare another model" }),
	);
	await user.type(screen.getByLabelText("Image prompt"), "A tree");
	await user.press(screen.getByRole("button", { name: "Generate image" }));
	expect(await screen.findByRole("alert")).toHaveTextContent(
		"Model unavailable",
	);
	expect(screen.getByLabelText("Generated image 1.1")).toBeOnTheScreen();
	await waitFor(() => expect(client.POST).toHaveBeenCalledTimes(1));
});
