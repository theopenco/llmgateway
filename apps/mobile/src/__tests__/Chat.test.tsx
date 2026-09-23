import Clipboard from "@react-native-clipboard/clipboard";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	act,
	fireEvent,
	render,
	screen,
	userEvent,
	waitFor,
} from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { api, client } from "@/api/client";
import { streamCompletion } from "@/api/completion";
import * as loungeCompletion from "@/api/lounge-completion";
import { rememberProjectExchange } from "@/api/project-memory";
import { uncertainToolOutcome } from "@/api/tool-parts";
import { DictationSheet } from "@/components/DictationSheet";
import { Chat } from "@/screens/Chat";

import type { ToolPart } from "@/api/tool-parts";

jest.mock("@react-native-clipboard/clipboard", () => ({
	setString: jest.fn(),
}));
jest.mock("@/api/client", () => ({
	api: { useQuery: jest.fn(), useMutation: () => ({ mutate: jest.fn() }) },
	client: { GET: jest.fn(), POST: jest.fn(), PATCH: jest.fn() },
	queryClient: { invalidateQueries: jest.fn() },
}));
jest.mock("@/api/project-memory", () => ({
	rememberProjectExchange: jest.fn(),
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
jest.mock("@/components/DictationSheet", () => ({
	DictationSheet: jest.fn(() => null),
}));
jest.mock("@/lib/files", () => ({ pickFile: jest.fn() }));
jest.mock("@/lib/export-file", () => ({ exportFile: jest.fn() }));
jest.useFakeTimers();

const query = api.useQuery as jest.Mock<unknown, unknown[]>;
const post = client.POST as jest.Mock<
	Promise<unknown>,
	[string, { body?: { tools?: string } }?]
>;
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
	jest.restoreAllMocks();
	jest.clearAllMocks();
	jest
		.mocked(client.GET)
		.mockResolvedValue({ data: { connectors: [] }, response: new Response() });
	query.mockReturnValue({
		data: { chat: { title: "Fixture", model: "auto" }, messages },
	});
	jest.mocked(streamCompletion).mockImplementation(async ({ onDelta }) => {
		onDelta({
			content: "New response",
			reasoning: "Considered the question",
			sources: [
				{
					type: "source-url",
					sourceId: "source",
					url: "https://example.com/guide",
					title: "Guide",
				},
			],
		});
	});
	jest
		.mocked(client.POST)
		.mockResolvedValue({ data: undefined, response: new Response() });
	jest
		.mocked(client.PATCH)
		.mockResolvedValue({ data: undefined, response: new Response() });
});

const proposal: ToolPart = {
	type: "dynamic-tool",
	toolCallId: "search",
	toolName: "gmail__search_messages",
	state: "approval-requested",
	input: { query: "demo" },
	approval: { id: "approval", signature: "fixture-signature" },
};
function withProposal() {
	query.mockReturnValue({
		data: {
			chat: { title: "Fixture", model: "auto" },
			messages: [
				messages[0],
				{
					...messages[1],
					tools: JSON.stringify([proposal]),
					toolParts: [proposal],
				},
			],
		},
	});
	return jest
		.spyOn(loungeCompletion, "generateLoungeReply")
		.mockImplementation(async ({ initial }) => ({
			model: "auto",
			content: "Mailbox checked",
			reasoning: "",
			sources: [],
			tools: initial?.tools,
		}));
}

test("requires approval, saves the outcome first, and prevents repeated taps from running twice", async () => {
	const generate = withProposal();
	let finish: (() => void) | undefined;
	const events: string[] = [];
	post.mockImplementation(async (path, options) => {
		if (path === "/connectors/{connectorId}/tools/{toolName}") {
			events.push("execute");
			await new Promise<void>((resolve) => {
				finish = resolve;
			});
			return { data: { result: '{"found":1}' }, response: new Response() };
		}
		const body = options?.body;
		if (body && "tools" in body && typeof body.tools === "string") {
			const parts = JSON.parse(body.tools) as ToolPart[];
			events.push(parts[0].state);
		}
		return { data: undefined, response: new Response() };
	});
	await showChat("chat");
	expect(client.POST).not.toHaveBeenCalled();
	expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
	const approve = screen.getByRole("button", {
		name: "Approve Gmail: search messages",
	});
	// Deliver both taps before the approval button is replaced on the next render.
	await act(async () => {
		await fireEvent.press(approve);
		await fireEvent.press(approve);
	});
	await waitFor(() => expect(events).toEqual(["output-error", "execute"]));
	expect(generate).not.toHaveBeenCalled();
	await act(async () => finish?.());
	await waitFor(() =>
		expect(screen.getByText("Mailbox checked")).toBeOnTheScreen(),
	);
	expect(events).toEqual([
		"output-error",
		"execute",
		"output-available",
		"output-available",
	]);
	expect(generate).toHaveBeenCalledTimes(1);
	expect(generate).toHaveBeenCalledWith(
		expect.objectContaining({
			messages: expect.arrayContaining([
				expect.objectContaining({
					id: "assistant",
					parts: expect.arrayContaining([
						expect.objectContaining({
							state: "output-available",
							output: { found: 1 },
							approval: expect.objectContaining({ approved: true }),
						}),
					]),
				}),
			]),
		}),
	);
	expect(
		screen.queryByRole("button", { name: "Approve Gmail: search messages" }),
	).toBeNull();
});

test("declining saves the decision and continues without calling the connected app", async () => {
	const generate = withProposal();
	await showChat("chat");
	await userEvent
		.setup()
		.press(
			screen.getByRole("button", { name: "Decline Gmail: search messages" }),
		);
	await waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
	expect(client.POST).not.toHaveBeenCalledWith(
		"/connectors/{connectorId}/tools/{toolName}",
		expect.anything(),
	);
	expect(generate).toHaveBeenCalledWith(
		expect.objectContaining({
			initial: expect.objectContaining({
				tools: [expect.objectContaining({ state: "output-denied" })],
			}),
		}),
	);
});

test("leaves an approval available when its prerequisite save fails", async () => {
	const generate = withProposal();
	jest.mocked(client.POST).mockRejectedValue(new Error("History unavailable"));
	await showChat("chat");
	await userEvent
		.setup()
		.press(
			screen.getByRole("button", { name: "Approve Gmail: search messages" }),
		);
	expect(await screen.findByText("History unavailable")).toBeOnTheScreen();
	expect(generate).not.toHaveBeenCalled();
	expect(client.POST).toHaveBeenCalledTimes(1);
	expect(
		screen.getByRole("button", { name: "Approve Gmail: search messages" }),
	).toBeEnabled();
});

test("a lost tool result stays consumed locally and can continue without replaying it", async () => {
	const generate = withProposal();
	jest.mocked(client.POST).mockImplementation(async (path) => {
		if (path === "/connectors/{connectorId}/tools/{toolName}") {
			throw new Error("Connection lost");
		}
		return { data: undefined, response: new Response() };
	});
	await showChat("chat");
	await userEvent
		.setup()
		.press(
			screen.getByRole("button", { name: "Approve Gmail: search messages" }),
		);
	await waitFor(() =>
		expect(screen.getAllByText(uncertainToolOutcome).length).toBeGreaterThan(0),
	);
	expect(
		screen.queryByRole("button", { name: "Approve Gmail: search messages" }),
	).toBeNull();
	expect(generate).not.toHaveBeenCalled();
	await userEvent
		.setup()
		.press(screen.getByRole("button", { name: "Continue response" }));
	await waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
	expect(
		post.mock.calls.filter(
			([path]) => path === "/connectors/{connectorId}/tools/{toolName}",
		),
	).toHaveLength(1);
	expect(generate).toHaveBeenCalledWith(
		expect.objectContaining({
			initial: expect.objectContaining({
				tools: [
					expect.objectContaining({
						state: "output-error",
						errorText: uncertainToolOutcome,
					}),
				],
			}),
		}),
	);
});
async function showChat(chatId?: string, onVoice?: () => void) {
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
					onVoice={onVoice}
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
					sources: JSON.stringify([
						{
							type: "source-url",
							sourceId: "source",
							url: "https://example.com/guide",
							title: "Guide",
						},
					]),
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
	await user.press(
		screen.getByRole("button", { name: "Conversation options" }),
	);
	await fireEvent(
		screen.getByRole("switch", { name: "Temporary conversation" }),
		"valueChange",
		true,
	);
	await user.press(
		screen.getByRole("button", { name: "Close conversation options" }),
	);
	await user.type(screen.getByLabelText("Message"), "Temporary question");
	await user.press(screen.getByRole("button", { name: "Send message" }));
	expect(await screen.findByText("New response")).toBeOnTheScreen();
	expect(client.POST).not.toHaveBeenCalled();
	expect(client.PATCH).not.toHaveBeenCalled();
	expect(rememberProjectExchange).not.toHaveBeenCalled();
	await user.press(screen.getByRole("button", { name: "Show reasoning" }));
	expect(screen.getByText("Considered the question")).toBeOnTheScreen();
	await user.press(screen.getAllByRole("button", { name: "Copy message" })[1]);
	expect(Clipboard.setString).toHaveBeenCalledWith("New response");
});

test("learns project memory only after saving the completed assistant reply", async () => {
	query.mockReturnValue({
		data: {
			chat: { title: "Fixture", model: "auto", projectId: "knowledge" },
			messages,
		},
	});
	await showChat("chat");
	await userEvent
		.setup()
		.press(screen.getByRole("button", { name: "Retry last response" }));
	await waitFor(() =>
		expect(rememberProjectExchange).toHaveBeenCalledWith(
			expect.objectContaining({
				knowledgeProjectId: "knowledge",
				billingProjectId: "project",
				userMessage: "Original question",
				reply: expect.objectContaining({ content: "New response" }),
				aborted: false,
			}),
		),
	);
	expect(jest.mocked(client.POST).mock.invocationCallOrder[0]).toBeLessThan(
		jest.mocked(rememberProjectExchange).mock.invocationCallOrder[0],
	);
});

test("adds dictation to the editable draft without sending it", async () => {
	await showChat();
	const user = userEvent.setup();
	await user.type(screen.getByLabelText("Message"), "Draft");
	await user.press(screen.getByRole("button", { name: "Dictate message" }));
	const props = jest.mocked(DictationSheet).mock.calls.at(-1)?.[0];
	expect(props).toBeDefined();
	await act(() => {
		props?.onInsert("spoken words");
		props?.onClose();
	});
	expect(screen.getByLabelText("Message")).toHaveDisplayValue(
		"Draft spoken words",
	);
	expect(client.POST).not.toHaveBeenCalled();
	expect(streamCompletion).not.toHaveBeenCalled();
});

test("opens voice from an empty composer and switches to send for a draft", async () => {
	const onVoice = jest.fn();
	await showChat(undefined, onVoice);
	const user = userEvent.setup();
	await user.press(
		screen.getByRole("button", { name: "Start voice conversation" }),
	);
	expect(onVoice).toHaveBeenCalledTimes(1);
	await user.type(screen.getByLabelText("Message"), "A question");
	expect(screen.getByRole("button", { name: "Send message" })).toBeEnabled();
	expect(
		screen.queryByRole("button", { name: "Start voice conversation" }),
	).not.toBeOnTheScreen();
});
