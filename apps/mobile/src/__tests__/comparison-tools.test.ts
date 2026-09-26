import { client } from "@/api/client";
import { continueComparison } from "@/api/comparison-tools";
import * as loungeCompletion from "@/api/lounge-completion";
import { saveReply } from "@/api/reply";
import { uncertainToolOutcome } from "@/api/tool-parts";

jest.mock("@/api/client", () => ({
	client: { GET: jest.fn(), POST: jest.fn() },
}));
jest.mock("@/api/chat-context", () => ({
	chatContext: async () => "Project context",
}));
jest.mock("@/api/reply", () => ({ saveReply: jest.fn() }));
jest.mock("@/api/project-memory", () => ({
	rememberProjectExchange: jest.fn(),
}));

const request = {
	type: "dynamic-tool",
	toolName: "gmail__search_messages",
	toolCallId: "search",
	state: "approval-requested",
	input: { query: "demo" },
	approval: { id: "approval", signature: "fixture-signature" },
};
const assistant = {
	id: "assistant",
	role: "assistant",
	content: "",
	tools: JSON.stringify([request]),
	metadata: {},
};
const history = {
	chat: {
		id: "root",
		model: "model-a",
		comparisonEnabled: true,
		parentChatId: null,
		status: "active",
	},
	messages: [
		{ id: "user", role: "user", content: "Find the meeting" },
		assistant,
	],
};
const reply = {
	model: "model-a",
	content: "Here is the meeting.",
	reasoning: "",
	sources: [],
};
const options = () => ({
	chatId: "root",
	projectId: "project",
	settings: {
		systemPrompt: "Be concise",
		reasoningEffort: "auto" as const,
		webSearch: false,
	},
	answer: { messageId: "assistant", toolCallId: "search", approved: true },
	signal: new AbortController().signal,
	onStored: jest.fn(),
	onReply: jest.fn(),
});

beforeEach(() => {
	jest.resetAllMocks();
	(client.GET as jest.Mock).mockResolvedValue({ data: history });
	(client.POST as jest.Mock).mockResolvedValue({
		data: { result: '{"messages":[{"id":"meeting"}]}' },
	});
	jest.spyOn(loungeCompletion, "generateLoungeReply").mockResolvedValue(reply);
});
afterEach(() => jest.restoreAllMocks());

test("persists uncertainty before executing, then stores the result before continuing only the root", async () => {
	const events: string[] = [];
	jest.mocked(saveReply).mockImplementation(async (_id, value) => {
		events.push(value.tools?.[0]?.state ?? "reply");
	});
	(client.POST as jest.Mock).mockImplementation(async () => {
		expect(events).toEqual(["output-error"]);
		events.push("execute");
		return { data: { result: '{"messages":[{"id":"meeting"}]}' } };
	});
	const args = options();
	await continueComparison(args);
	expect(events).toEqual([
		"output-error",
		"execute",
		"output-available",
		"reply",
	]);
	expect(saveReply).toHaveBeenLastCalledWith("root", reply, "assistant");
	expect(args.onStored).toHaveBeenCalledTimes(3);
	expect(loungeCompletion.generateLoungeReply).toHaveBeenCalledWith(
		expect.objectContaining({
			model: "model-a",
			messages: expect.arrayContaining([
				expect.objectContaining({
					id: "assistant",
					parts: [
						expect.objectContaining({
							state: "output-available",
							output: { messages: [{ id: "meeting" }] },
						}),
					],
				}),
			]),
		}),
	);
});

test("declines without executing a connector", async () => {
	const args = options();
	await continueComparison({
		...args,
		answer: { ...args.answer, approved: false },
	});
	expect(client.POST).not.toHaveBeenCalled();
	expect(saveReply).toHaveBeenNthCalledWith(
		1,
		"root",
		expect.objectContaining({
			tools: [expect.objectContaining({ state: "output-denied" })],
			toolContinuation: true,
		}),
		"assistant",
	);
	expect(loungeCompletion.generateLoungeReply).toHaveBeenCalledTimes(1);
});

test("does not execute when the safeguard cannot be saved", async () => {
	jest
		.mocked(saveReply)
		.mockRejectedValueOnce(new Error("History unavailable"));
	await expect(continueComparison(options())).rejects.toThrow(
		"History unavailable",
	);
	expect(client.POST).not.toHaveBeenCalled();
	expect(loungeCompletion.generateLoungeReply).not.toHaveBeenCalled();
});

test("an interrupted action stays uncertain and continuation after restart does not replay it", async () => {
	(client.POST as jest.Mock).mockRejectedValueOnce(
		new Error("Connection lost"),
	);
	const args = options();
	await expect(continueComparison(args)).rejects.toThrow(uncertainToolOutcome);
	const stored = args.onStored.mock.calls[0][0];
	expect(stored.metadata.toolContinuation).toBe(true);
	(client.GET as jest.Mock).mockResolvedValue({
		data: { ...history, messages: [history.messages[0], stored] },
	});
	await continueComparison({ ...options(), answer: undefined });
	expect(client.POST).toHaveBeenCalledTimes(1);
	expect(loungeCompletion.generateLoungeReply).toHaveBeenCalledTimes(1);
	expect(loungeCompletion.generateLoungeReply).toHaveBeenCalledWith(
		expect.objectContaining({
			initial: expect.objectContaining({
				tools: [
					expect.objectContaining({
						state: "output-error",
						errorText: uncertainToolOutcome,
					}),
				],
			}),
		}),
	);
});

test("waits for every pending approval before calling the model", async () => {
	(client.GET as jest.Mock).mockResolvedValue({
		data: {
			...history,
			messages: [
				history.messages[0],
				{
					...assistant,
					tools: JSON.stringify([
						request,
						{ ...request, toolCallId: "second" },
					]),
				},
			],
		},
	});
	await continueComparison(options());
	expect(client.POST).toHaveBeenCalledTimes(1);
	expect(loungeCompletion.generateLoungeReply).not.toHaveBeenCalled();
});

test.each([
	{ ...history.chat, comparisonEnabled: false },
	{ ...history.chat, status: "archived" },
])(
	"rejects invalid or archived comparison roots before any action",
	async (chat) => {
		(client.GET as jest.Mock).mockResolvedValue({ data: { ...history, chat } });
		await expect(continueComparison(options())).rejects.toThrow();
		expect(saveReply).not.toHaveBeenCalled();
		expect(client.POST).not.toHaveBeenCalled();
		expect(loungeCompletion.generateLoungeReply).not.toHaveBeenCalled();
	},
);

test("refuses a stale approval if another session already answered it", async () => {
	(client.GET as jest.Mock).mockResolvedValue({
		data: {
			...history,
			messages: [
				history.messages[0],
				{
					...assistant,
					tools: JSON.stringify([{ ...request, state: "output-denied" }]),
				},
			],
		},
	});
	await expect(continueComparison(options())).rejects.toThrow(
		"already been answered",
	);
	expect(client.POST).not.toHaveBeenCalled();
});

test("retains the completed draft when continuation cannot be saved", async () => {
	jest
		.mocked(saveReply)
		.mockResolvedValueOnce(undefined)
		.mockResolvedValueOnce(undefined)
		.mockRejectedValueOnce(new Error("History unavailable"));
	const args = options();
	await expect(continueComparison(args)).rejects.toThrow("History unavailable");
	expect(args.onReply).toHaveBeenLastCalledWith(reply, "assistant");
	expect(args.onStored).toHaveBeenCalledTimes(2);
});
