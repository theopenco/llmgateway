import { client } from "@/api/client";
import { ensureGatewayKey } from "@/api/gateway-key";
import {
	generateLoungeReply,
	LoungeReplyStream,
	loungeMessage,
} from "@/api/lounge-completion";

jest.mock("@/api/client", () => ({
	client: { GET: jest.fn(), POST: jest.fn() },
}));
jest.mock("@/api/gateway-key", () => ({
	ensureGatewayKey: jest.fn(async () => "test-token"),
}));
const event = (value: Record<string, unknown>) => JSON.stringify(value);
const input = {
	type: "tool-input-available",
	toolCallId: "call",
	toolName: "gmail__search_messages",
	input: { query: "demo" },
	providerMetadata: { fixture: { thought: "preserved" } },
};
const approval = {
	type: "tool-approval-request",
	toolCallId: "call",
	approvalId: "approval",
	signature: "fixture-signature",
};
beforeEach(() => jest.clearAllMocks());

test("collects signed proposals, reasoning and sources without executing tools", () => {
	const stream = new LoungeReplyStream("auto");
	stream.consume(event({ type: "reasoning-delta", delta: "Checking" }));
	stream.consume(event(input));
	stream.consume(event(approval));
	stream.consume(
		event({
			type: "source-url",
			sourceId: "source",
			url: "https://example.com",
			title: "Source",
		}),
	);
	expect(stream.reply).toMatchObject({
		reasoning: "Checking",
		tools: [
			{
				state: "approval-requested",
				input: { query: "demo" },
				approval: { id: "approval", signature: "fixture-signature" },
				callProviderMetadata: input.providerMetadata,
			},
		],
	});
	expect(stream.reply.sources).toHaveLength(1);
	expect(client.POST).not.toHaveBeenCalled();
});

test("continuation retains previous tool results and separates new text", () => {
	const initial = {
		model: "auto",
		content: "I will check.",
		reasoning: "",
		sources: [],
		tools: [
			{
				type: "dynamic-tool" as const,
				toolCallId: "call",
				toolName: "gmail__search_messages",
				input: {},
				state: "output-available" as const,
				output: { found: 1 },
			},
		],
	};
	const stream = new LoungeReplyStream("auto", initial);
	stream.consume(event({ type: "text-delta", delta: "Found" }));
	stream.consume(event({ type: "text-delta", delta: " one message." }));
	expect(stream.reply.content).toBe("I will check.\n\nFound one message.");
	expect(stream.reply.tools).toEqual(initial.tools);
});

test("interrupted proposals cannot be approved after a restart", () => {
	const stream = new LoungeReplyStream("auto");
	stream.consume(event(input));
	stream.consume(event(approval));
	const reply = stream.interrupt(new Error("Connection lost"));
	expect(reply.tools?.[0]).toMatchObject({
		state: "output-error",
		approval: undefined,
	});
	expect(reply.tools?.[0].errorText).toContain("before approval");
});

test("rejects approvals with missing inputs or signatures", () => {
	const stream = new LoungeReplyStream("auto");
	expect(() => stream.consume(event(approval))).toThrow(
		"complete tool request",
	);
	stream.consume(event(input));
	expect(() =>
		stream.consume(event({ ...approval, signature: undefined })),
	).toThrow("invalid stream event");
});

test("restores attachment, reasoning and tool history as API UI messages", () => {
	const tools = [
		{
			type: "dynamic-tool",
			toolCallId: "call",
			toolName: "gmail__search_messages",
			state: "output-available",
			input: {},
			output: { found: 1 },
		},
	];
	const message = loungeMessage({
		id: "message",
		role: "assistant",
		content: "Found it.",
		reasoning: "Checked",
		attachments: [
			{
				id: "file",
				name: "file.pdf",
				mediaType: "application/pdf",
				url: "data:application/pdf;base64,cGRm",
			},
		],
		tools: JSON.stringify(tools),
	});
	expect(message.parts).toEqual([
		{ type: "reasoning", text: "Checked" },
		{ type: "text", text: "Found it." },
		{
			type: "file",
			filename: "file.pdf",
			mediaType: "application/pdf",
			url: "data:application/pdf;base64,cGRm",
		},
		...tools,
	]);
});

test("uses active connectors and the selected project's key", async () => {
	jest.mocked(client.GET).mockResolvedValue({
		data: {
			connectors: [
				{ id: "gmail", available: true, connected: true, enabled: true },
				{ id: "slack", available: true, connected: true, enabled: false },
				{ id: "notion", available: false, connected: true, enabled: true },
			],
		},
		response: new Response(),
	});
	jest
		.mocked(client.POST)
		.mockResolvedValue({ data: "", response: new Response() });
	await generateLoungeReply({
		projectId: "project",
		model: "auto",
		messages: [
			{ id: "user", role: "user", parts: [{ type: "text", text: "Hi" }] },
		],
		settings: { systemPrompt: "", reasoningEffort: "high", webSearch: true },
		signal: new AbortController().signal,
		onReply: jest.fn(),
	});
	expect(ensureGatewayKey).toHaveBeenCalledWith("project");
	expect(client.POST).toHaveBeenCalledWith(
		"/lounge/chat",
		expect.objectContaining({
			headers: { "x-llmgateway-key": "test-token" },
			body: expect.objectContaining({
				connectors: ["gmail"],
				reasoningEffort: "high",
				webSearch: true,
			}),
			parseAs: "text",
			fetch: expect.any(Function),
		}),
	);
});
