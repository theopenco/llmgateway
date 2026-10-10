import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	fireEvent,
	render,
	screen,
	userEvent,
	waitFor,
} from "@testing-library/react-native";
import { Alert } from "react-native";

import { api, queryClient } from "@/api/client";
import { authorizeConnector } from "@/api/connectors";
import { Connectors } from "@/screens/Connectors";

jest.mock("@/api/client", () => ({
	api: { useQuery: jest.fn(), useMutation: jest.fn() },
	queryClient: { invalidateQueries: jest.fn() },
}));
jest.mock("@/api/connectors", () => ({ authorizeConnector: jest.fn() }));
jest.useFakeTimers();
const update = jest.fn();
const remove = jest.fn();
const gmail = {
	id: "gmail",
	name: "Gmail",
	description: "Search mail",
	available: true,
	connected: false,
	enabled: false,
};

beforeEach(() => {
	jest.clearAllMocks();
	(api.useQuery as jest.Mock).mockReturnValue({
		data: {
			connectors: [
				gmail,
				{
					id: "shopify",
					name: "Shopify",
					description: "Search store",
					available: true,
					connected: false,
					enabled: false,
				},
				{
					id: "linear",
					name: "Linear",
					description: "Search issues",
					available: false,
					connected: false,
					enabled: false,
				},
			],
		},
	});
	(api.useMutation as jest.Mock).mockImplementation((method: string) => ({
		mutate: method === "patch" ? update : remove,
		reset: jest.fn(),
		isPending: false,
	}));
	jest.mocked(authorizeConnector).mockResolvedValue("connected");
});
async function show() {
	await render(
		<QueryClientProvider
			client={
				new QueryClient({ defaultOptions: { mutations: { retry: false } } })
			}
		>
			<Connectors />
		</QueryClientProvider>,
	);
	return userEvent.setup();
}

test("searches the catalogue and leaves unavailable connectors disabled", async () => {
	const user = await show();
	expect(screen.getByText("Not configured")).toBeOnTheScreen();
	expect(
		screen.queryByRole("button", { name: "Connect Linear" }),
	).not.toBeOnTheScreen();
	await user.type(screen.getByLabelText("Search connectors"), "mail");
	expect(
		screen.getByRole("button", { name: "Connect Gmail" }),
	).toBeOnTheScreen();
	expect(screen.queryByText("Shopify")).not.toBeOnTheScreen();
	await user.clear(screen.getByLabelText("Search connectors"));
	await user.type(screen.getByLabelText("Search connectors"), "no match");
	expect(
		screen.getByText("No connectors match your search."),
	).toBeOnTheScreen();
});

test("reports successful sign-in and refreshes account connections", async () => {
	const user = await show();
	await user.press(screen.getByRole("button", { name: "Connect Gmail" }));
	expect(await screen.findByText("Connected to Gmail.")).toBeOnTheScreen();
	expect(authorizeConnector).toHaveBeenCalledWith(
		"gmail",
		undefined,
		expect.any(AbortSignal),
	);
	expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
		queryKey: ["get", "/connectors"],
	});
});

test("keeps a failed sign-in retryable and describes browser cancellation", async () => {
	jest
		.mocked(authorizeConnector)
		.mockRejectedValueOnce(new Error("Try signing in again."))
		.mockResolvedValueOnce("cancelled");
	const user = await show();
	await user.press(screen.getByRole("button", { name: "Connect Gmail" }));
	expect(await screen.findByRole("alert")).toHaveTextContent(
		"Try signing in again.",
	);
	await user.press(screen.getByRole("button", { name: "Connect Gmail" }));
	expect(
		await screen.findByText(
			"Sign-in cancelled. Your connections are unchanged.",
		),
	).toBeOnTheScreen();
	expect(screen.queryByRole("alert")).not.toBeOnTheScreen();
});

test("requires a store domain for a new Shopify connection", async () => {
	const user = await show();
	expect(
		screen.getByRole("button", { name: "Connect Shopify" }),
	).toBeDisabled();
	await user.type(
		screen.getByLabelText("Shopify store"),
		"fixture.myshopify.com",
	);
	await user.press(screen.getByRole("button", { name: "Connect Shopify" }));
	await waitFor(() =>
		expect(authorizeConnector).toHaveBeenCalledWith(
			"shopify",
			"fixture.myshopify.com",
			expect.any(AbortSignal),
		),
	);
});

test("pauses a connection and requires confirmation before disconnecting", async () => {
	(api.useQuery as jest.Mock).mockReturnValue({
		data: { connectors: [{ ...gmail, connected: true, enabled: true }] },
	});
	const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
	const user = await show();
	await fireEvent(
		screen.getByRole("switch", { name: "Enable Gmail" }),
		"valueChange",
		false,
	);
	expect(update).toHaveBeenCalledWith({
		params: { path: { connectorId: "gmail" } },
		body: { enabled: false },
	});
	await user.press(screen.getByRole("button", { name: "Disconnect Gmail" }));
	expect(remove).not.toHaveBeenCalled();
	const buttons = alert.mock.calls[0][2]!;
	buttons.find((button) => button.text === "Disconnect")!.onPress!();
	expect(remove).toHaveBeenCalledWith({
		params: { path: { connectorId: "gmail" } },
	});
	alert.mockRestore();
});
