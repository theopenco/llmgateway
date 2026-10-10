import Clipboard from "@react-native-clipboard/clipboard";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	fireEvent,
	render,
	screen,
	userEvent,
	waitFor,
} from "@testing-library/react-native";
import { Alert } from "react-native";

import { api, client } from "@/api/client";
import { ChatSharing } from "@/components/ChatSharing";

jest.mock("@react-native-clipboard/clipboard", () => ({
	setString: jest.fn(),
}));
jest.mock("@/api/client", () => ({
	api: { useQuery: jest.fn() },
	client: { POST: jest.fn(), DELETE: jest.fn() },
	queryClient: { invalidateQueries: jest.fn() },
}));
jest.mock("@/config", () => ({
	config: { webUrl: "https://lounge.llmgateway.io" },
}));
jest.useFakeTimers();

beforeEach(() => {
	jest.clearAllMocks();
	(api.useQuery as jest.Mock).mockReturnValue({
		data: { share: { allowForking: true, allowDiscovery: false } },
	});
	jest
		.mocked(client.POST)
		.mockResolvedValue({ data: undefined, response: new Response() });
	jest
		.mocked(client.DELETE)
		.mockResolvedValue({ data: undefined, response: new Response() });
});
async function show(
	publicShareId?: string,
	orgShares: { id: string; organizationId: string }[] = [],
) {
	await render(
		<QueryClientProvider client={new QueryClient()}>
			<ChatSharing
				chatId="chat"
				organizationId="organization"
				publicShareId={publicShareId}
				orgShares={orgShares}
			/>
		</QueryClientProvider>,
	);
	const user = userEvent.setup();
	await user.press(screen.getByRole("button", { name: "Share" }));
	return user;
}

test("creates an unlisted public snapshot with explicit fork permission", async () => {
	const user = await show();
	await fireEvent(
		screen.getByRole("switch", { name: "Allow readers to fork" }),
		"valueChange",
		true,
	);
	await user.press(screen.getByRole("button", { name: "Create share link" }));
	await waitFor(() =>
		expect(client.POST).toHaveBeenCalledWith("/chats/{id}/share", {
			params: { path: { id: "chat" } },
			body: { visibility: "public", allowForking: true, allowDiscovery: false },
		}),
	);
});

test("copies an absolute URL and revokes a public share only after confirmation", async () => {
	const alert = jest.spyOn(Alert, "alert");
	const user = await show("public-snapshot");
	await user.press(screen.getByRole("button", { name: "Copy share link" }));
	expect(Clipboard.setString).toHaveBeenCalledWith(
		"https://lounge.llmgateway.io/share/public-snapshot",
	);
	await user.press(screen.getByRole("button", { name: "Revoke share link" }));
	expect(client.DELETE).not.toHaveBeenCalled();
	const confirm = alert.mock.calls[0][2]?.find(
		(button) => button.text === "Revoke link",
	);
	expect(confirm).toBeDefined();
	confirm?.onPress?.();
	await waitFor(() =>
		expect(client.DELETE).toHaveBeenCalledWith("/chats/{id}/share", {
			params: { path: { id: "chat" } },
		}),
	);
	alert.mockRestore();
});

test("keeps organization snapshots out of public discovery", async () => {
	const user = await show();
	await fireEvent(
		screen.getByRole("switch", { name: "List in public discovery" }),
		"valueChange",
		true,
	);
	await user.press(screen.getByRole("button", { name: "Audience: public" }));
	await user.press(screen.getByRole("button", { name: "organization" }));
	expect(
		screen.queryByRole("switch", { name: "List in public discovery" }),
	).not.toBeOnTheScreen();
	await user.press(screen.getByRole("button", { name: "Create share link" }));
	await waitFor(() =>
		expect(client.POST).toHaveBeenCalledWith("/chats/{id}/share", {
			params: { path: { id: "chat" } },
			body: {
				visibility: "organization",
				organizationId: "organization",
				allowForking: false,
				allowDiscovery: false,
			},
		}),
	);
});
