import Clipboard from "@react-native-clipboard/clipboard";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	fireEvent,
	render,
	screen,
	userEvent,
	waitFor,
} from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { api, client } from "@/api/client";
import { streamCompletion } from "@/api/completion";
import { Chat } from "@/screens/Chat";

jest.mock("@react-native-clipboard/clipboard", () => ({
	setString: jest.fn(),
}));
jest.mock("@/api/client", () => ({
	api: { useQuery: jest.fn(), useMutation: () => ({ mutate: jest.fn() }) },
	client: { POST: jest.fn(), PATCH: jest.fn() },
	queryClient: { invalidateQueries: jest.fn() },
}));
jest.mock("@/api/completion", () => ({ streamCompletion: jest.fn() }));
jest.mock("@/api/chat-context", () => ({ chatContext: async () => "" }));
jest.mock("@/lib/preferences", () => ({
	defaultChatSettings: {
		systemPrompt: "",
		reasoningEffort: "auto",
		webSearch: false,
	},
	usePreferences: () => ({
		data: {
			chat: {
				systemPrompt: "Be concise",
				reasoningEffort: "auto",
				webSearch: false,
			},
		},
	}),
}));
jest.mock("@/components/ChatSettings", () => ({ ChatSettings: () => null }));
jest.mock("@/components/ModelPicker", () => ({ ModelPicker: () => null }));
jest.mock("@/lib/files", () => ({ pickFile: jest.fn() }));
jest.mock("@/lib/export-file", () => ({ exportFile: jest.fn() }));
jest.useFakeTimers();

const query = api.useQuery as jest.Mock<unknown, unknown[]>;
const image = "data:image/png;base64,aW1hZ2U=";
const savedImages = JSON.stringify([
	{ type: "image_url", image_url: { url: image } },
]);
const messages = [
	{
		id: "user",
		role: "user",
		content: "Original question",
		images: savedImages,
		attachments: [
			{ id: "image", name: "Image.png", mediaType: "image/png", url: image },
		],
	},
	{
		id: "assistant",
		role: "assistant",
		content: "Original response",
		attachments: [],
	},
];
beforeEach(() => {
	jest.clearAllMocks();
	query.mockReturnValue({
		data: { chat: { title: "Fixture", model: "auto" }, messages },
	});
	jest.mocked(streamCompletion).mockImplementation(async ({ onDelta }) => {
		onDelta({ content: "New response", reasoning: "Considered the question" });
	});
	jest
		.mocked(client.POST)
		.mockResolvedValue({ data: undefined, response: new Response() });
	jest
		.mocked(client.PATCH)
		.mockResolvedValue({ data: undefined, response: new Response() });
});
async function showChat(chatId?: string) {
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
				<Chat
					chatId={chatId}
					organizationId="organization"
					projectId="project"
				/>
			</QueryClientProvider>
		</SafeAreaProvider>,
	);
}

test("retries the last answer with its original attachments and replaces the saved assistant", async () => {
	await showChat("chat");
	const user = userEvent.setup();
	await user.type(screen.getByLabelText("Message"), "My next question");
	await user.press(screen.getByRole("button", { name: "Retry last response" }));
	await waitFor(() =>
		expect(client.POST).toHaveBeenCalledWith(
			"/chats/{id}/messages",
			expect.objectContaining({
				body: expect.objectContaining({
					id: "assistant",
					content: "New response",
				}),
			}),
		),
	);
	expect(screen.getByLabelText("Message")).toHaveDisplayValue(
		"My next question",
	);
	expect(streamCompletion).toHaveBeenCalledWith(
		expect.objectContaining({
			messages: [
				{ role: "system", content: "Be concise" },
				{
					role: "user",
					content: [
						{ type: "text", text: "Original question" },
						{ type: "image_url", image_url: { url: image } },
					],
				},
			],
		}),
	);
});

test("preserves attachments when editing and excludes later replies from regeneration", async () => {
	await showChat("chat");
	const user = userEvent.setup();
	await user.press(screen.getByRole("button", { name: "Edit message" }));
	await user.clear(screen.getByLabelText("Edited message"));
	await user.type(screen.getByLabelText("Edited message"), "Revised question");
	await user.press(screen.getByRole("button", { name: "Save and regenerate" }));
	await waitFor(() => expect(client.POST).toHaveBeenCalledTimes(1));
	expect(client.PATCH).toHaveBeenCalledWith(
		"/chats/{id}/messages/{messageId}",
		{
			params: { path: { id: "chat", messageId: "user" } },
			body: {
				content: "Revised question",
				images: savedImages,
				audios: undefined,
			},
		},
	);
	expect(streamCompletion).toHaveBeenCalledWith(
		expect.objectContaining({
			messages: [
				{ role: "system", content: "Be concise" },
				{
					role: "user",
					content: [
						{ type: "text", text: "Revised question" },
						{ type: "image_url", image_url: { url: image } },
					],
				},
			],
		}),
	);
});

test("keeps temporary messages out of persisted history and supports copying and reasoning", async () => {
	query.mockReturnValue({ data: undefined });
	await showChat();
	const user = userEvent.setup();
	await fireEvent(
		screen.getByRole("switch", { name: "Temporary conversation" }),
		"valueChange",
		true,
	);
	await user.type(screen.getByLabelText("Message"), "Temporary question");
	await user.press(screen.getByRole("button", { name: "Send message" }));
	expect(await screen.findByText("New response")).toBeOnTheScreen();
	expect(client.POST).not.toHaveBeenCalled();
	expect(client.PATCH).not.toHaveBeenCalled();
	await user.press(screen.getByRole("button", { name: "Show reasoning" }));
	expect(screen.getByText("Considered the question")).toBeOnTheScreen();
	await user.press(screen.getAllByRole("button", { name: "Copy message" })[1]);
	expect(Clipboard.setString).toHaveBeenCalledWith("New response");
});
