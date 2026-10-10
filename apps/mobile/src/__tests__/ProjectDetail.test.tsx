import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	render,
	screen,
	userEvent,
	waitFor,
} from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { client, queryClient } from "@/api/client";
import { pickKnowledgeFile } from "@/lib/knowledge-files";
import { ProjectDetail } from "@/screens/ProjectDetail";

jest.mock("@/api/client", () => ({
	api: {
		useQuery: (_method: string, path: string) => ({
			data:
				path === "/chat-projects/{id}"
					? { project: { name: "Research" }, files: [] }
					: path.endsWith("memories")
						? { memories: [] }
						: { chats: [] },
		}),
		useMutation: () => ({ mutate: jest.fn() }),
	},
	client: { POST: jest.fn() },
	queryClient: { invalidateQueries: jest.fn() },
}));
jest.mock("@/api/gateway-key", () => ({
	ensureGatewayKey: async () => "test-token",
}));
jest.mock("@/lib/knowledge-files", () => ({ pickKnowledgeFile: jest.fn() }));
jest.useFakeTimers();

test("shows upload failures and refreshes indexed file state so an error row can be removed", async () => {
	jest.mocked(pickKnowledgeFile).mockResolvedValue({
		name: "notes.md",
		mimeType: "text/markdown",
		base64: "dGV4dA==",
	});
	jest
		.mocked(client.POST)
		.mockRejectedValue(new Error("Could not index the file"));
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
				<ProjectDetail
					id="knowledge"
					billingProjectId="billing"
					onChat={jest.fn()}
					onNewChat={jest.fn()}
				/>
			</QueryClientProvider>
		</SafeAreaProvider>,
	);
	await userEvent
		.setup()
		.press(screen.getByRole("button", { name: "Add knowledge file" }));
	expect(await screen.findByRole("alert")).toHaveTextContent(
		"Could not index the file",
	);
	await waitFor(() =>
		expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
			queryKey: ["get", "/chat-projects/{id}"],
		}),
	);
	expect(client.POST).toHaveBeenCalledWith("/chat-projects/{id}/files", {
		params: { path: { id: "knowledge" } },
		body: {
			name: "notes.md",
			mimeType: "text/markdown",
			contentBase64: "dGV4dA==",
		},
		headers: { "x-llmgateway-key": "test-token" },
	});
});
