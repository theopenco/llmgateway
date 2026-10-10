import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	render,
	screen,
	userEvent,
	waitFor,
} from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { client } from "@/api/client";
import { completeComparisonPanel, loadComparison } from "@/api/comparison";
import { continueComparison } from "@/api/comparison-tools";
import { saveReply } from "@/api/reply";
import { Comparison } from "@/screens/Comparison";

jest.mock("@/api/client", () => ({
	client: { GET: jest.fn() },
	queryClient: { invalidateQueries: jest.fn() },
}));
jest.mock("@/api/comparison", () => ({
	loadComparison: jest.fn(),
	completeComparisonPanel: jest.fn(),
	createComparison: jest.fn(),
}));
jest.mock("@/api/comparison-tools", () => ({ continueComparison: jest.fn() }));
jest.mock("@/api/reply", () => ({ saveReply: jest.fn() }));
jest.mock("@/lib/chat-files", () => ({ pickChatAttachment: jest.fn() }));
jest.mock("@/lib/export-file", () => ({ exportFile: jest.fn() }));
jest.mock("@/lib/preferences", () => ({
	usePreferences: () => ({
		data: {
			chat: { systemPrompt: "", reasoningEffort: "auto", webSearch: false },
		},
	}),
}));
jest.mock("@/components/ChatSettings", () => ({ ChatSettings: () => null }));
jest.mock("@/components/ModelPicker", () => ({ ModelPicker: () => null }));
jest.mock("@react-native-clipboard/clipboard", () => ({
	setString: jest.fn(),
}));
jest.useFakeTimers();

beforeEach(() => {
	jest.resetAllMocks();
	(loadComparison as jest.Mock).mockResolvedValue(
		["first", "second"].map((id) => ({
			chat: { id, model: id, title: "Saved comparison", status: "active" },
			messages: [],
		})),
	);
});

async function show() {
	await render(
		<SafeAreaProvider
			initialMetrics={{
				frame: { x: 0, y: 0, width: 400, height: 850 },
				insets: { top: 60, bottom: 30, left: 0, right: 0 },
			}}
		>
			<QueryClientProvider
				client={
					new QueryClient({ defaultOptions: { queries: { retry: false } } })
				}
			>
				<Comparison
					chatId="first"
					organizationId="workspace"
					projectId="project"
					onOpenChat={jest.fn()}
				/>
			</QueryClientProvider>
		</SafeAreaProvider>,
	);
	await screen.findByText("Saved comparison");
	const user = userEvent.setup();
	await user.type(screen.getByLabelText("Message to all models"), "A question");
	return user;
}

test("isolates a failed model and lets the user inspect its error", async () => {
	jest
		.mocked(completeComparisonPanel)
		.mockImplementation(async ({ panel, onSaved }) => {
			if (panel.id === "second") {
				throw new Error("Model unavailable");
			}
			onSaved();
		});
	const user = await show();
	await user.press(screen.getByRole("button", { name: "Send to all models" }));
	await screen.findByText(
		"Some models need attention. Select a model to review its result.",
	);
	expect(completeComparisonPanel).toHaveBeenCalledTimes(2);
	await user.press(screen.getByRole("button", { name: "Model 2" }));
	expect(screen.getByRole("alert")).toHaveTextContent("Model unavailable");
});

test("retries saving a retained reply without calling the models again", async () => {
	jest
		.mocked(completeComparisonPanel)
		.mockImplementation(async ({ panel, onReply, onSaved }) => {
			if (panel.id === "first") {
				onReply({
					model: "first",
					content: "An answer worth keeping",
					reasoning: "",
					sources: [],
				});
				throw new Error("History unavailable");
			}
			onSaved();
		});
	(client.GET as jest.Mock).mockResolvedValue({
		data: { messages: [{ id: "user", role: "user", content: "A question" }] },
	});
	const user = await show();
	await user.press(screen.getByRole("button", { name: "Send to all models" }));
	await user.press(
		await screen.findByRole("button", { name: "Retry saving response" }),
	);
	await waitFor(() =>
		expect(saveReply).toHaveBeenCalledWith(
			"first",
			expect.objectContaining({ content: "An answer worth keeping" }),
			undefined,
		),
	);
	expect(completeComparisonPanel).toHaveBeenCalledTimes(2);
	await waitFor(() =>
		expect(
			screen.queryByRole("button", { name: "Retry saving response" }),
		).not.toBeOnTheScreen(),
	);
});

const pendingRequest = {
	type: "dynamic-tool" as const,
	toolName: "gmail__search_messages",
	toolCallId: "search",
	state: "approval-requested" as const,
	input: { query: "demo" },
};
function pendingHistory(): Awaited<ReturnType<typeof loadComparison>> {
	return ["first", "second"].map((id) => ({
		chat: {
			id,
			model: id,
			title: "Saved comparison",
			status: "active",
			webSearch: false,
			pinned: false,
			comparisonEnabled: id === "first",
			shareId: null,
			sharedAt: null,
			orgShares: [],
			projectId: null,
			createdAt: "2026-09-16T00:00:00Z",
			updatedAt: "2026-09-16T00:00:00Z",
			messageCount: id === "first" ? 2 : 1,
		},
		comparisonChatIds: id === "first" ? ["second"] : [],
		messages: [
			{
				images: null,
				audios: null,
				reasoning: null,
				tools: null,
				sources: null,
				metadata: null,
				sequence: 0,
				createdAt: "2026-09-16T00:00:00Z",
				id: "user-" + id,
				role: "user",
				content: "Find the meeting",
				attachments: [],
				sourceLinks: [],
			},
			...(id === "first"
				? [
						{
							images: null,
							audios: null,
							reasoning: null,
							sources: null,
							tools: JSON.stringify([pendingRequest]),
							metadata: null,
							sequence: 1,
							createdAt: "2026-09-16T00:00:00Z",
							id: "assistant",
							role: "assistant" as const,
							content: "",
							attachments: [],
							sourceLinks: [],
							toolParts: [pendingRequest],
						},
					]
				: []),
		],
	}));
}

test("restores primary approvals and keeps other models separate", async () => {
	jest.mocked(loadComparison).mockResolvedValue(pendingHistory());
	const user = await show();
	expect(
		screen.getByRole("button", { name: "Approve Gmail: search messages" }),
	).toBeEnabled();
	expect(
		screen.getByRole("button", { name: "Send to all models" }),
	).toBeDisabled();
	expect(
		screen.getByRole("button", { name: "Retry this model" }),
	).toBeDisabled();
	await user.press(screen.getByRole("button", { name: "Model 2" }));
	expect(
		screen.queryByRole("button", { name: "Approve Gmail: search messages" }),
	).not.toBeOnTheScreen();
	expect(
		screen.getByRole("button", { name: "Retry this model" }),
	).toBeEnabled();
	await user.press(screen.getByRole("button", { name: "Model 1" }));
	await user.press(
		screen.getByRole("button", { name: "Decline Gmail: search messages" }),
	);
	expect(continueComparison).toHaveBeenCalledWith(
		expect.objectContaining({
			chatId: "first",
			answer: { messageId: "assistant", toolCallId: "search", approved: false },
		}),
	);
});

test("an interrupted approval exposes continuation without another Approve button", async () => {
	jest.mocked(loadComparison).mockResolvedValue(pendingHistory());
	jest
		.mocked(continueComparison)
		.mockImplementation(async ({ onStored, signal }) => {
			onStored({
				...pendingHistory()[0].messages[1],
				metadata: { toolContinuation: true },
				toolParts: [
					{
						...pendingRequest,
						state: "output-error",
						errorText: "The result could not be confirmed.",
					},
				],
			});
			await new Promise<void>((_resolve, reject) =>
				signal.addEventListener("abort", () =>
					reject(new Error("The result could not be confirmed.")),
				),
			);
		});
	const user = await show();
	await user.press(
		screen.getByRole("button", { name: "Approve Gmail: search messages" }),
	);
	await user.press(
		await screen.findByRole("button", { name: "Stop response" }),
	);
	await waitFor(() =>
		expect(
			screen.getByRole("button", { name: "Continue response" }),
		).toBeEnabled(),
	);
	expect(
		screen.queryByRole("button", { name: "Approve Gmail: search messages" }),
	).not.toBeOnTheScreen();
	expect(continueComparison).toHaveBeenCalledTimes(1);
});
