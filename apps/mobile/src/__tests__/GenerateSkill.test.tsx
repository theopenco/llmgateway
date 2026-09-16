import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	render,
	screen,
	userEvent,
	waitFor,
} from "@testing-library/react-native";

import { client } from "@/api/client";
import { ensureGatewayKey } from "@/api/gateway-key";
import { GenerateSkill } from "@/components/GenerateSkill";

jest.mock("@/api/client", () => ({ client: { POST: jest.fn() } }));
jest.mock("@/api/gateway-key", () => ({ ensureGatewayKey: jest.fn() }));
jest.useFakeTimers();
const draft = {
	name: "Writing",
	description: "Be clear",
	instructions: "Use short sentences.",
};

beforeEach(() => {
	jest.clearAllMocks();
	jest.mocked(ensureGatewayKey).mockResolvedValue("test-token");
	jest
		.mocked(client.POST)
		.mockResolvedValue({ data: { skill: draft }, response: new Response() });
});
async function showGenerator() {
	const onGenerated = jest.fn();
	const onCancel = jest.fn();
	await render(
		<QueryClientProvider
			client={
				new QueryClient({ defaultOptions: { mutations: { retry: false } } })
			}
		>
			<GenerateSkill
				projectId="billing"
				onGenerated={onGenerated}
				onCancel={onCancel}
			/>
		</QueryClientProvider>,
	);
	return { onGenerated, onCancel, user: userEvent.setup() };
}

test("generates a reviewable draft with the selected workspace key without saving it", async () => {
	const { user, onGenerated } = await showGenerator();
	expect(screen.getByRole("button", { name: "Generate draft" })).toBeDisabled();
	await user.type(
		screen.getByLabelText("What should this skill do?"),
		"  Write clearly  ",
	);
	await user.press(screen.getByRole("button", { name: "Generate draft" }));
	await waitFor(() => expect(onGenerated).toHaveBeenCalledWith(draft));
	expect(ensureGatewayKey).toHaveBeenCalledWith("billing");
	expect(client.POST).toHaveBeenCalledTimes(1);
	expect(client.POST).toHaveBeenCalledWith(
		"/skills/generate",
		expect.objectContaining({
			body: { prompt: "Write clearly" },
			headers: { "x-llmgateway-key": "test-token" },
		}),
	);
});

test("keeps the request editable after a failure and retries it", async () => {
	jest
		.mocked(client.POST)
		.mockRejectedValueOnce(new Error("Generation unavailable"));
	const { user, onGenerated } = await showGenerator();
	await user.type(
		screen.getByLabelText("What should this skill do?"),
		"Write clearly",
	);
	await user.press(screen.getByRole("button", { name: "Generate draft" }));
	expect(await screen.findByRole("alert")).toHaveTextContent(
		"Generation unavailable",
	);
	expect(
		screen.getByLabelText("What should this skill do?"),
	).toHaveDisplayValue("Write clearly");
	await user.press(screen.getByRole("button", { name: "Generate draft" }));
	await waitFor(() => expect(onGenerated).toHaveBeenCalledWith(draft));
});

test("cancel aborts generation and discards a late response", async () => {
	let finish: (() => void) | undefined;
	jest.mocked(client.POST).mockImplementation(
		() =>
			new Promise((resolve) => {
				finish = () =>
					resolve({ data: { skill: draft }, response: new Response() });
			}),
	);
	const { user, onGenerated, onCancel } = await showGenerator();
	await user.type(
		screen.getByLabelText("What should this skill do?"),
		"Write clearly",
	);
	await user.press(screen.getByRole("button", { name: "Generate draft" }));
	await user.press(screen.getByRole("button", { name: "Cancel generation" }));
	expect(onCancel).toHaveBeenCalled();
	expect(client.POST).toHaveBeenCalledWith(
		"/skills/generate",
		expect.objectContaining({
			signal: expect.objectContaining({ aborted: true }),
		}),
	);
	finish?.();
	await waitFor(() =>
		expect(
			screen.getByRole("button", { name: "Generate draft" }),
		).toBeEnabled(),
	);
	expect(onGenerated).not.toHaveBeenCalled();
});
