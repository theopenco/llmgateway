import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	render,
	screen,
	userEvent,
	waitFor,
} from "@testing-library/react-native";
import { Text } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { clearSession } from "@/auth/session";
import { WorkspaceGate } from "@/components/WorkspaceGate";
import { useWorkspace } from "@/lib/workspace";
import { Workspaces } from "@/screens/Workspaces";

jest.mock("@/auth/session", () => ({ clearSession: jest.fn() }));
jest.mock("@/lib/workspace", () => ({ useWorkspace: jest.fn() }));
jest.mock("@/screens/Workspaces", () => ({ Workspaces: jest.fn() }));
jest.useFakeTimers();
const query = useWorkspace as jest.Mock<unknown, unknown[]>;
const refetch = jest.fn();
beforeEach(() => {
	jest.resetAllMocks();
	jest
		.mocked(Workspaces)
		.mockImplementation(() => <Text>Workspace picker</Text>);
	query.mockReturnValue({
		isPending: false,
		isError: true,
		error: new Error("Offline"),
		refetch,
	});
});
async function show() {
	const content = jest.fn(() => <Text>Conversation tools</Text>);
	const onSignedOut = jest.fn();
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
				<WorkspaceGate onSignedOut={onSignedOut}>{content}</WorkspaceGate>
			</QueryClientProvider>
		</SafeAreaProvider>,
	);
	return { content, onSignedOut };
}

test("blocks conversation tools while loading a saved workspace", async () => {
	query.mockReturnValue({ isPending: true });
	const { content } = await show();
	expect(content).not.toHaveBeenCalled();
	expect(screen.queryByText("Conversation tools")).toBeNull();
});

test("a failed validation never renders stale billing context and offers retry", async () => {
	query.mockReturnValue({
		isPending: false,
		isError: true,
		error: new Error("Offline"),
		data: { organizationId: "old", projectId: "old" },
		refetch,
	});
	const { content } = await show();
	expect(content).not.toHaveBeenCalled();
	expect(screen.getByText("Offline")).toBeOnTheScreen();
	await userEvent
		.setup()
		.press(screen.getByRole("button", { name: "Try again" }));
	expect(refetch).toHaveBeenCalledTimes(1);
});

test("requires an explicit action to choose a replacement workspace", async () => {
	const { content } = await show();
	expect(screen.queryByText("Workspace picker")).toBeNull();
	await userEvent
		.setup()
		.press(screen.getByRole("button", { name: "Choose workspace" }));
	expect(screen.getByText("Workspace picker")).toBeOnTheScreen();
	expect(content).not.toHaveBeenCalled();
});

test("clears the session before returning to sign-in", async () => {
	const { onSignedOut } = await show();
	await userEvent
		.setup()
		.press(screen.getByRole("button", { name: "Sign in again" }));
	await waitFor(() => expect(onSignedOut).toHaveBeenCalledTimes(1));
	expect(clearSession).toHaveBeenCalledTimes(1);
});

test("passes only the validated workspace to the application", async () => {
	const workspace = {
		organizationId: "organization",
		projectId: "project",
		name: "Test Organization",
	};
	query.mockReturnValue({ data: workspace, isError: false });
	const { content } = await show();
	expect(content).toHaveBeenCalledWith(workspace);
	expect(screen.getByText("Conversation tools")).toBeOnTheScreen();
});
