import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	render,
	screen,
	userEvent,
	waitFor,
} from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { client } from "@/api/client";
import { runDecision } from "@/api/decisions";
import { DecisionStudio } from "@/screens/DecisionStudio";

jest.mock("@react-native-clipboard/clipboard", () => ({
	setString: jest.fn(),
}));
jest.mock("@/api/client", () => ({
	api: {
		useQuery: (_method: string, path: string) => ({
			data:
				path === "/internal/models"
					? {
							models: [
								{
									id: "jev",
									name: "Jev",
									status: "active",
									output: ["decision"],
									mappings: [{ providerId: "typesafe", vision: false }],
								},
							],
						}
					: path === "/playground/decision-history"
						? {
								items: [
									{
										id: "saved",
										prompt: "Old ticket",
										title: "Billing triage",
										createdAt: "2026-11-01T10:00:00.000Z",
										inputImageCount: 0,
										questions: [],
										models: [],
									},
								],
							}
						: { favorites: [] },
		}),
		useMutation: () => ({ mutate: jest.fn() }),
	},
	client: { POST: jest.fn() },
	queryClient: { invalidateQueries: jest.fn() },
}));
jest.mock("@/api/decisions", () => ({
	...jest.requireActual("@/api/decisions"),
	runDecision: jest.fn(),
}));
jest.mock("@/lib/files", () => ({ pickFile: jest.fn() }));
jest.useFakeTimers();

beforeEach(() => jest.clearAllMocks());

async function renderStudio() {
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
				<DecisionStudio organizationId="organization" projectId="project" />
			</QueryClientProvider>
		</SafeAreaProvider>,
	);
}

test("runs a preset, shows probabilities and saves the run", async () => {
	jest.mocked(runDecision).mockResolvedValue({
		modelId: "jev",
		modelName: "jev",
		answers: [
			{
				type: "choice",
				name: "department",
				choice: "billing",
				probabilities: [
					{ value: "billing", probability: 0.9 },
					{ value: "technical", probability: 0.06 },
					{ value: "sales", probability: 0.04 },
				],
			},
			{ type: "predicate", name: "is_urgent", probability: 0.75 },
			{
				type: "score",
				name: "churn_risk",
				score: 0.7,
				probabilities: [
					{ value: 0, probability: 0.1 },
					{ value: 1, probability: 0.2 },
					{ value: 2, probability: 0.6 },
					{ value: 3, probability: 0.1 },
				],
			},
		],
	});
	jest.mocked(client.POST).mockResolvedValue({
		data: { item: { id: "new" } },
		response: new Response(),
	});
	await renderStudio();
	const user = userEvent.setup();
	await user.press(
		screen.getByRole("button", { name: "Decision model 1: Choose" }),
	);
	await user.press(screen.getByRole("button", { name: "Choose Jev" }));
	expect(
		screen.queryByRole("button", { name: "Add image" }),
	).not.toBeOnTheScreen();
	await user.press(
		screen.getByRole("button", { name: "Triage a support ticket" }),
	);
	await user.press(screen.getByRole("button", { name: "Run decision" }));
	expect(await screen.findByLabelText("billing: 90%")).toBeOnTheScreen();
	expect(screen.getAllByText("billing")).toHaveLength(2);
	expect(screen.getByText("75% yes")).toBeOnTheScreen();
	expect(screen.getByLabelText("High: 60%")).toBeOnTheScreen();
	expect(runDecision).toHaveBeenCalledWith(
		"project",
		"jev",
		expect.stringContaining("charged twice"),
		[],
		expect.arrayContaining([expect.objectContaining({ name: "department" })]),
	);
	await waitFor(() =>
		expect(client.POST).toHaveBeenCalledWith("/playground/decision-history", {
			body: expect.objectContaining({
				organizationId: "organization",
				models: [expect.objectContaining({ modelId: "jev" })],
			}),
		}),
	);
});

test("blocks runs until the questions are valid", async () => {
	await renderStudio();
	const user = userEvent.setup();
	await user.press(
		screen.getByRole("button", { name: "Decision model 1: Choose" }),
	);
	await user.press(screen.getByRole("button", { name: "Choose Jev" }));
	await user.type(screen.getByLabelText("Text to evaluate"), "Hello");
	expect(screen.getByText("Question 1 needs instructions.")).toBeOnTheScreen();
	expect(screen.getByRole("button", { name: "Run decision" })).toBeDisabled();
	await user.type(
		screen.getByLabelText("Question 1 instructions"),
		"Is this a greeting?",
	);
	expect(screen.getByRole("button", { name: "Run decision" })).toBeEnabled();
	expect(
		screen.getByRole("button", { name: "View decision: Billing triage" }),
	).toBeOnTheScreen();
});
