import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	act,
	render,
	screen,
	userEvent,
	waitFor,
} from "@testing-library/react-native";
import { Alert } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { api, client } from "@/api/client";
import { clearSession } from "@/auth/session";
import { DeleteAccount } from "@/screens/DeleteAccount";

jest.mock("@/api/client", () => ({
	api: { useQuery: jest.fn() },
	client: { DELETE: jest.fn() },
}));
jest.mock("@/auth/session", () => ({ clearSession: jest.fn() }));
jest.useFakeTimers();

beforeEach(() => {
	jest.clearAllMocks();
	(client.DELETE as jest.Mock).mockReset();
	jest.mocked(clearSession).mockReset();
	(api.useQuery as jest.Mock).mockReturnValue({
		data: {
			organizations: [{ id: "workspace", name: "Test workspace" }],
			activeSubscriptions: 0,
		},
	});
	jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
});
afterEach(() => jest.mocked(Alert.alert).mockRestore());

async function show() {
	const onDeleted = jest.fn();
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
				<DeleteAccount onDeleted={onDeleted} />
			</QueryClientProvider>
		</SafeAreaProvider>,
	);
	return { onDeleted, user: userEvent.setup() };
}
async function confirm() {
	const button = jest
		.mocked(Alert.alert)
		.mock.calls.at(-1)?.[2]
		?.find((item) => item.style === "destructive");
	expect(button).toBeDefined();
	await act(async () => button?.onPress?.());
}

test("does not offer deletion until its impact preview is available", async () => {
	(api.useQuery as jest.Mock).mockReturnValue({
		error: new Error("Preview unavailable"),
	});
	await show();
	expect(screen.getByRole("alert")).toHaveTextContent("Preview unavailable");
	expect(
		screen.queryByRole("button", { name: "Permanently delete account" }),
	).not.toBeOnTheScreen();
	expect(client.DELETE).not.toHaveBeenCalled();
});

test("requires typed confirmation and a separate destructive alert", async () => {
	const { user } = await show();
	expect(screen.getByText("Test workspace")).toBeOnTheScreen();
	expect(
		screen.getByRole("button", { name: "Permanently delete account" }),
	).toBeDisabled();
	await user.type(screen.getByLabelText("Type DELETE to confirm"), "DELETE");
	await user.press(
		screen.getByRole("button", { name: "Permanently delete account" }),
	);
	expect(Alert.alert).toHaveBeenCalledWith(
		"Delete your account permanently?",
		expect.any(String),
		expect.arrayContaining([
			expect.objectContaining({ text: "Keep account", style: "cancel" }),
		]),
	);
	expect(client.DELETE).not.toHaveBeenCalled();
	expect(clearSession).not.toHaveBeenCalled();
});

test("keeps the session and exposes an error if deletion fails", async () => {
	(client.DELETE as jest.Mock).mockRejectedValue(
		new Error("Deletion unavailable"),
	);
	const { user, onDeleted } = await show();
	await user.type(screen.getByLabelText("Type DELETE to confirm"), "DELETE");
	await user.press(
		screen.getByRole("button", { name: "Permanently delete account" }),
	);
	await confirm();
	expect(await screen.findByRole("alert")).toHaveTextContent(
		"Deletion unavailable",
	);
	expect(clearSession).not.toHaveBeenCalled();
	expect(onDeleted).not.toHaveBeenCalled();
});

test("clears secure local state after server deletion and returns to sign-in", async () => {
	const events: string[] = [];
	(client.DELETE as jest.Mock).mockImplementation(async () => {
		events.push("deleted");
	});
	jest.mocked(clearSession).mockImplementation(async () => {
		events.push("cleared");
	});
	const { user, onDeleted } = await show();
	onDeleted.mockImplementation(() => events.push("signed-out"));
	await user.type(screen.getByLabelText("Type DELETE to confirm"), "DELETE");
	await user.press(
		screen.getByRole("button", { name: "Permanently delete account" }),
	);
	await confirm();
	await waitFor(() =>
		expect(events).toEqual(["deleted", "cleared", "signed-out"]),
	);
	expect(client.DELETE).toHaveBeenCalledWith("/user/me", {});
});
