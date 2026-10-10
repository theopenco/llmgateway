import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, userEvent, waitFor } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { takeEscapeTurn } from "@/api/escape";
import { Escape } from "@/screens/Escape";

import { applyMove, createGame } from "@llmgateway/shared/sandbox-escape";

jest.mock("@/api/escape", () => ({
	takeEscapeTurn: jest.fn(),
	saveEscapeRun: jest.fn(),
}));
jest.mock("@react-navigation/native", () => ({ useIsFocused: () => true }));
jest.mock("@/components/ModelPicker", () => ({ ModelPicker: () => null }));
jest.mock("@/lib/escape-model", () => ({
	useEscapeModel: () => ({
		data: "chosen-model",
		isPending: false,
		isError: false,
		save: { isPending: false, mutate: jest.fn() },
	}),
}));
jest.useFakeTimers();
beforeEach(() => jest.clearAllMocks());
async function show() {
	return await render(
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
				<Escape
					projectId="selected-project"
					organizationId="selected-workspace"
					onHistory={jest.fn()}
					onLeaderboard={jest.fn()}
					onReplay={jest.fn()}
				/>
			</QueryClientProvider>
		</SafeAreaProvider>,
	);
}

test("reports a mutation error and lets the player retry the same board", async () => {
	jest
		.mocked(takeEscapeTurn)
		.mockRejectedValueOnce(new Error("Gateway unavailable"))
		.mockResolvedValueOnce({
			move: "down",
			state: applyMove(createGame(1), "down"),
			thought: "Move toward the key",
			understood: true,
			usedModel: "chosen-model",
			usage: { promptTokens: 10, completionTokens: 2, cost: 0, durationMs: 5 },
		});
	const view = await show();
	const user = userEvent.setup();
	await user.press(view.getByRole("button", { name: "One step" }));
	await waitFor(() =>
		expect(view.getByText("Gateway unavailable")).toBeTruthy(),
	);
	expect(takeEscapeTurn).toHaveBeenCalledTimes(1);
	await user.press(view.getByRole("button", { name: "One step" }));
	await waitFor(() => expect(view.getByText(/Step 1 \/ /)).toBeTruthy());
	expect(view.queryByText("Gateway unavailable")).toBeNull();
	expect(jest.mocked(takeEscapeTurn).mock.calls.map(([body]) => body)).toEqual([
		{
			projectId: "selected-project",
			model: "chosen-model",
			levelId: 1,
			moves: [],
		},
		{
			projectId: "selected-project",
			model: "chosen-model",
			levelId: 1,
			moves: [],
		},
	]);
});

test("leaving the game aborts its active mutation", async () => {
	jest
		.mocked(takeEscapeTurn)
		.mockImplementation(
			(_body, signal) =>
				new Promise((_resolve, reject) =>
					signal.addEventListener("abort", () => reject(new Error("Canceled"))),
				),
		);
	const view = await show();
	await userEvent.setup().press(view.getByRole("button", { name: "One step" }));
	await waitFor(() => expect(takeEscapeTurn).toHaveBeenCalledTimes(1));
	const signal = jest.mocked(takeEscapeTurn).mock.calls[0][1];
	expect(signal.aborted).toBe(false);
	await view.unmount();
	expect(signal.aborted).toBe(true);
});
