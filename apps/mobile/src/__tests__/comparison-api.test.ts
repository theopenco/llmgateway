import { client } from "@/api/client";
import { completeComparisonPanel, createComparison } from "@/api/comparison";
import { streamCompletion } from "@/api/completion";
import * as loungeCompletion from "@/api/lounge-completion";

jest.mock("@/api/client", () => ({
	client: { GET: jest.fn(), POST: jest.fn(), PATCH: jest.fn() },
}));
jest.mock("@/api/chat-context", () => ({
	chatContext: async () => "Project instructions",
}));
jest.mock("@/api/completion", () => ({ streamCompletion: jest.fn() }));

const settings = {
	systemPrompt: "Be concise",
	reasoningEffort: "auto" as const,
	webSearch: false,
};
const history = {
	chat: { id: "root", model: "model-a" },
	messages: [
		{ id: "user", role: "user", content: "A question" },
		{ id: "assistant", role: "assistant", content: "Old answer" },
	],
};
beforeEach(() => {
	jest.resetAllMocks();
	(client.GET as jest.Mock).mockResolvedValue({ data: history });
	(client.POST as jest.Mock).mockResolvedValue({ data: {} });
	jest.mocked(streamCompletion).mockImplementation(async ({ onDelta }) => {
		onDelta({ content: "New answer", reasoning: "Thought" });
	});
});

test("resumes partially created comparisons without creating another root", async () => {
	(client.POST as jest.Mock)
		.mockResolvedValueOnce({ data: { chat: { id: "root" } } })
		.mockRejectedValueOnce(new Error("Unavailable"));
	const onCreated = jest.fn();
	const args = {
		models: ["model-a", "model-b"],
		organizationId: "workspace",
		title: "Compare",
		onCreated,
	};
	await expect(createComparison({ ...args, panels: [] })).rejects.toThrow(
		"Unavailable",
	);
	expect(onCreated).toHaveBeenCalledWith([{ id: "root", model: "model-a" }]);
	(client.POST as jest.Mock).mockResolvedValueOnce({
		data: { chat: { id: "child" } },
	});
	await createComparison({
		...args,
		panels: [{ id: "root", model: "model-a" }],
	});
	expect(client.POST).toHaveBeenLastCalledWith("/chats", {
		body: expect.objectContaining({
			parentChatId: "root",
			comparisonEnabled: false,
			model: "model-b",
		}),
	});
	expect(client.POST).toHaveBeenCalledTimes(3);
});

test("retries one model by replacing its answer and retaining its user message", async () => {
	const onSaved = jest.fn();
	await completeComparisonPanel({
		panel: { id: "root", model: "model-b" },
		projectId: "project",
		prompt: "Unsent draft",
		attachments: [],
		settings,
		signal: new AbortController().signal,
		onReply: jest.fn(),
		onSaved,
		retry: true,
	});
	expect(client.POST).toHaveBeenCalledTimes(1);
	expect(client.POST).toHaveBeenCalledWith("/chats/{id}/messages", {
		params: { path: { id: "root" } },
		body: expect.objectContaining({
			id: "assistant",
			role: "assistant",
			content: "New answer",
		}),
	});
	expect(jest.mocked(streamCompletion).mock.calls[0][0].messages).toEqual([
		{ role: "system", content: "Be concise\n\nProject instructions" },
		{ role: "user", content: "A question" },
	]);
	expect(onSaved).toHaveBeenCalledTimes(1);
});

test("saves partial output before surfacing a provider error", async () => {
	jest.mocked(streamCompletion).mockImplementation(async ({ onDelta }) => {
		onDelta({ content: "Partial", reasoning: "" });
		throw new Error("Provider disconnected");
	});
	const onSaved = jest.fn();
	await expect(
		completeComparisonPanel({
			panel: { id: "root", model: "model-a" },
			projectId: "project",
			prompt: "Next question",
			attachments: [],
			settings,
			signal: new AbortController().signal,
			onReply: jest.fn(),
			onSaved,
		}),
	).rejects.toThrow("Provider disconnected");
	expect(client.POST).toHaveBeenLastCalledWith("/chats/{id}/messages", {
		params: { path: { id: "root" } },
		body: expect.objectContaining({
			content: "Partial",
			metadata: expect.objectContaining({
				model: "model-a",
				interrupted: true,
			}),
		}),
	});
	expect(onSaved).toHaveBeenCalledTimes(1);
});

test("exposes a completed draft when saving fails so it can be saved without regeneration", async () => {
	(client.POST as jest.Mock)
		.mockResolvedValueOnce({ data: {} })
		.mockRejectedValueOnce(new Error("History unavailable"));
	const onReply = jest.fn();
	const onSaved = jest.fn();
	await expect(
		completeComparisonPanel({
			panel: { id: "root", model: "model-a" },
			projectId: "project",
			prompt: "Next question",
			attachments: [],
			settings,
			signal: new AbortController().signal,
			onReply,
			onSaved,
		}),
	).rejects.toThrow("History unavailable");
	expect(onReply).toHaveBeenLastCalledWith(
		expect.objectContaining({ content: "New answer", reasoning: "Thought" }),
	);
	expect(onSaved).not.toHaveBeenCalled();
});

afterEach(() => jest.restoreAllMocks());

test.each([true, false])(
	"only the primary panel can use connector transport (primary=%s)",
	async (primary) => {
		const tool = {
			type: "dynamic-tool",
			toolName: "gmail__search_messages",
			toolCallId: "search",
			state: "output-available",
			input: { query: "demo" },
			output: { messages: [] },
		};
		(client.GET as jest.Mock).mockResolvedValue({
			data: {
				...history,
				chat: { ...history.chat, comparisonEnabled: primary },
				messages: [
					history.messages[0],
					{ ...history.messages[1], tools: JSON.stringify([tool]) },
				],
			},
		});
		const generate = jest
			.spyOn(loungeCompletion, "generateLoungeReply")
			.mockResolvedValue({
				model: "model-a",
				content: "Tool-aware answer",
				reasoning: "",
				sources: [],
				tools: [],
			});
		await completeComparisonPanel({
			panel: { id: "root", model: "model-a" },
			primary,
			projectId: "project",
			prompt: "Next question",
			attachments: [],
			settings,
			signal: new AbortController().signal,
			onReply: jest.fn(),
			onSaved: jest.fn(),
		});
		if (primary) {
			expect(generate).toHaveBeenCalledWith(
				expect.objectContaining({
					messages: expect.arrayContaining([
						expect.objectContaining({
							id: "assistant",
							parts: expect.arrayContaining([tool]),
						}),
					]),
				}),
			);
			expect(streamCompletion).not.toHaveBeenCalled();
		} else {
			expect(generate).not.toHaveBeenCalled();
			expect(streamCompletion).toHaveBeenCalledTimes(1);
		}
	},
);

test("a pending primary request blocks a new prompt before saving it", async () => {
	(client.GET as jest.Mock).mockResolvedValue({
		data: {
			...history,
			messages: [
				history.messages[0],
				{
					...history.messages[1],
					tools: JSON.stringify([
						{
							type: "dynamic-tool",
							toolName: "gmail__search_messages",
							toolCallId: "search",
							state: "approval-requested",
							input: { query: "demo" },
						},
					]),
				},
			],
		},
	});
	await expect(
		completeComparisonPanel({
			panel: { id: "root", model: "model-a" },
			primary: true,
			projectId: "project",
			prompt: "Next question",
			attachments: [],
			settings,
			signal: new AbortController().signal,
			onReply: jest.fn(),
			onSaved: jest.fn(),
		}),
	).rejects.toThrow("Review the requests");
	expect(client.POST).not.toHaveBeenCalled();
	expect(streamCompletion).not.toHaveBeenCalled();
});
