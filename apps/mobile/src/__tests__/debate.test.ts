import { streamCompletion } from "@/api/completion";
import { runDebate } from "@/api/debate";

import type { DebateTurn } from "@/api/debate";

jest.mock("@/api/completion", () => ({ streamCompletion: jest.fn() }));

beforeEach(() => {
	jest.clearAllMocks();
	jest.mocked(streamCompletion).mockImplementation(async ({ onDelta }) => {
		onDelta({
			content: `Argument ${jest.mocked(streamCompletion).mock.calls.length}`,
			reasoning: "Considered",
		});
	});
});

function options() {
	const controller = new AbortController();
	const result: DebateTurn[] = [];
	const args = {
		projectId: "project",
		models: ["model-a", "model-b"],
		topic: "Discuss urban gardens",
		turns: [] as DebateTurn[],
		settings: {
			systemPrompt: "",
			reasoningEffort: "auto" as const,
			webSearch: false,
		},
		signal: controller.signal,
		onTurn: (index: number, turn: DebateTurn) => {
			result[index] = turn;
		},
	};
	return { args, controller, result };
}

test("runs five turns in rotation and gives each model the previous argument", async () => {
	const { args, result } = options();
	await runDebate(args);
	expect(result.map((turn) => turn.model)).toEqual([
		"model-a",
		"model-b",
		"model-a",
		"model-b",
		"model-a",
	]);
	expect(result.every((turn) => turn.finished)).toBe(true);
	expect(
		jest.mocked(streamCompletion).mock.calls[1][0].messages[1].content,
	).toContain("Argument 1");
});

test("stops before calling another model and preserves the partial turn", async () => {
	const { args, controller, result } = options();
	jest.mocked(streamCompletion).mockImplementation(async ({ onDelta }) => {
		onDelta({ content: "Partial argument", reasoning: "" });
		controller.abort();
		throw new Error("Response stopped.");
	});
	await runDebate(args);
	expect(streamCompletion).toHaveBeenCalledTimes(1);
	expect(result[0]).toMatchObject({
		content: "Partial argument",
		interrupted: true,
		finished: true,
	});
});

test("retains completed turns when the next model fails", async () => {
	const { args, result } = options();
	jest
		.mocked(streamCompletion)
		.mockImplementationOnce(async ({ onDelta }) => {
			onDelta({ content: "First argument", reasoning: "" });
		})
		.mockRejectedValueOnce(new Error("Model unavailable"));
	await expect(runDebate(args)).rejects.toThrow("Model unavailable");
	expect(result[0].content).toBe("First argument");
	expect(result[1].error).toBe("Model unavailable");
	expect(streamCompletion).toHaveBeenCalledTimes(2);
});

test("rejects duplicate participants before making a model request", async () => {
	const { args } = options();
	await expect(
		runDebate({ ...args, models: ["model-a", "model-a"] }),
	).rejects.toThrow("different models");
	expect(streamCompletion).not.toHaveBeenCalled();
});
