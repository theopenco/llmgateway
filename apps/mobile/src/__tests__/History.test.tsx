import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	render,
	screen,
	userEvent,
	waitFor,
} from "@testing-library/react-native";

import { client } from "@/api/client";
import { History } from "@/screens/History";

jest.mock("@/api/client", () => ({
	api: { useMutation: () => ({ mutate: jest.fn() }) },
	client: { GET: jest.fn() },
	queryClient: { invalidateQueries: jest.fn() },
}));
jest.useFakeTimers();

const chat = {
	id: "chat",
	title: "A saved conversation",
	model: "auto",
	status: "active",
	messageCount: 2,
};
beforeEach(() => jest.clearAllMocks());

async function show() {
	await render(
		<QueryClientProvider
			client={
				new QueryClient({ defaultOptions: { queries: { retry: false } } })
			}
		>
			<History organizationId="workspace" onChat={jest.fn()} />
		</QueryClientProvider>,
	);
	return userEvent.setup();
}

test("searches message text on the server and scopes archived results", async () => {
	(client.GET as jest.Mock).mockResolvedValue({
		data: { chats: [chat], total: 1 },
	});
	const user = await show();
	await user.type(screen.getByLabelText("Search conversations"), "sunflowers");
	await waitFor(() =>
		expect(client.GET).toHaveBeenCalledWith(
			"/chats/search",
			expect.objectContaining({
				params: {
					query: {
						organizationId: "workspace",
						status: "active",
						q: "sunflowers",
						limit: 50,
						offset: 0,
					},
				},
			}),
		),
	);
	expect(await screen.findByText("A saved conversation")).toBeOnTheScreen();
	await user.press(
		screen.getByRole("button", { name: "Show archived conversations" }),
	);
	await waitFor(() =>
		expect(client.GET).toHaveBeenLastCalledWith(
			"/chats/search",
			expect.objectContaining({
				params: {
					query: {
						organizationId: "workspace",
						status: "archived",
						q: "sunflowers",
						limit: 50,
						offset: 0,
					},
				},
			}),
		),
	);
});

test("loads the next page without replacing earlier conversations", async () => {
	(client.GET as jest.Mock)
		.mockResolvedValueOnce({
			data: { chats: [{ ...chat, title: "First page" }], total: 2 },
		})
		.mockResolvedValueOnce({
			data: { chats: [{ ...chat, id: "next", title: "Next page" }], total: 2 },
		});
	const user = await show();
	await user.press(
		await screen.findByRole("button", { name: "Load more conversations" }),
	);
	await waitFor(() => expect(screen.getByText("Next page")).toBeOnTheScreen());
	expect(screen.getByText("First page")).toBeOnTheScreen();
	expect(
		screen.queryByRole("button", { name: "Load more conversations" }),
	).not.toBeOnTheScreen();
	expect(client.GET).toHaveBeenLastCalledWith(
		"/chats/search",
		expect.objectContaining({
			params: {
				query: {
					organizationId: "workspace",
					status: "active",
					q: "",
					limit: 50,
					offset: 1,
				},
			},
		}),
	);
});
