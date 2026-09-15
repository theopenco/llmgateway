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
