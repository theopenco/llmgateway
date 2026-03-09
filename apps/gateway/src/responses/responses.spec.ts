import { describe, it, expect, vi } from "vitest";

import { convertChatResponseToResponses } from "./tools/convert-chat-to-responses.js";
import { convertResponsesInputToMessages } from "./tools/convert-responses-to-chat.js";
import {
	createStreamingState,
	createResponseCreatedEvent,
	processStreamChunk,
	createCompletionEvents,
	createFailedEvent,
} from "./tools/convert-streaming-to-responses.js";

vi.mock("@llmgateway/cache", () => ({
	redisClient: {
		setex: vi.fn().mockResolvedValue("OK"),
		get: vi.fn().mockResolvedValue(null),
	},
}));

vi.mock("@llmgateway/logger", () => ({
	logger: {
		warn: vi.fn(),
		error: vi.fn(),
	},
}));

describe("convertResponsesInputToMessages", () => {
	it("converts string input to user message", () => {
		const result = convertResponsesInputToMessages("Hello");
		expect(result).toEqual([{ role: "user", content: "Hello" }]);
	});

	it("adds instructions as system message", () => {
		const result = convertResponsesInputToMessages("Hello", "Be helpful");
		expect(result).toEqual([
			{ role: "system", content: "Be helpful" },
			{ role: "user", content: "Hello" },
		]);
	});

	it("passes through regular messages", () => {
		const input = [
			{ role: "user" as const, content: "Hello" },
			{ role: "assistant" as const, content: "Hi there" },
		];
		const result = convertResponsesInputToMessages(input);
		expect(result).toHaveLength(2);
		expect(result[0]!.role).toBe("user");
		expect(result[0]!.content).toBe("Hello");
		expect(result[1]!.role).toBe("assistant");
		expect(result[1]!.content).toBe("Hi there");
	});

	it("converts function_call items to assistant tool_calls", () => {
		const input = [
			{ role: "user" as const, content: "What's the weather?" },
			{
				type: "function_call" as const,
				call_id: "call_123",
				name: "get_weather",
				arguments: '{"location": "SF"}',
			},
		];
		const result = convertResponsesInputToMessages(input);
		expect(result).toHaveLength(2);
		expect(result[1]!.role).toBe("assistant");
		expect(result[1]!.content).toBeNull();
		expect(result[1]!.tool_calls).toEqual([
			{
				id: "call_123",
				type: "function",
				function: {
					name: "get_weather",
					arguments: '{"location": "SF"}',
				},
			},
		]);
	});

	it("groups consecutive function_call items into one assistant message", () => {
		const input = [
			{
				type: "function_call" as const,
				call_id: "call_1",
				name: "get_weather",
				arguments: '{"location": "SF"}',
			},
			{
				type: "function_call" as const,
				call_id: "call_2",
				name: "get_time",
				arguments: '{"timezone": "PST"}',
			},
		];
		const result = convertResponsesInputToMessages(input);
		expect(result).toHaveLength(1);
		expect(result[0]!.tool_calls).toHaveLength(2);
	});

	it("converts function_call_output to tool messages", () => {
		const input = [
			{
				type: "function_call_output" as const,
				call_id: "call_123",
				output: '{"temp": 72}',
			},
		];
		const result = convertResponsesInputToMessages(input);
		expect(result).toEqual([
			{
				role: "tool",
				content: '{"temp": 72}',
				tool_call_id: "call_123",
			},
		]);
	});

	it("converts input_text content type to text", () => {
		const input = [
			{
				role: "user" as const,
				content: [{ type: "input_text" as const, text: "Hello" }],
			},
		];
		const result = convertResponsesInputToMessages(input);
		expect(result[0]!.content).toEqual([{ type: "text", text: "Hello" }]);
	});

	it("maps developer role to system", () => {
		const input = [
			{ role: "developer" as const, content: "You are helpful" },
			{ role: "user" as const, content: "Hello" },
		];
		const result = convertResponsesInputToMessages(input);
		expect(result[0]!.role).toBe("system");
		expect(result[0]!.content).toBe("You are helpful");
	});
});

describe("convertChatResponseToResponses", () => {
	it("converts a basic chat response", () => {
		const chatResponse = {
			id: "chatcmpl-123",
			object: "chat.completion",
			created: 1710000000,
			model: "gpt-4o-mini",
			choices: [
				{
					index: 0,
					message: {
						role: "assistant",
						content: "Hello!",
					},
					finish_reason: "stop",
				},
			],
			usage: {
				prompt_tokens: 10,
				completion_tokens: 5,
				total_tokens: 15,
			},
		};

		const result = convertChatResponseToResponses(
			chatResponse,
			"openai/gpt-4o-mini",
		);

		expect(result.object).toBe("response");
		expect(result.id).toMatch(/^resp_/);
		expect(result.status).toBe("completed");
		expect(result.model).toBe("gpt-4o-mini");
		expect(result.usage.input_tokens).toBe(10);
		expect(result.usage.output_tokens).toBe(5);

		const messageOutput = result.output.find((o) => o.type === "message");
		expect(messageOutput).toBeDefined();
		expect((messageOutput as any).content[0].type).toBe("output_text");
		expect((messageOutput as any).content[0].text).toBe("Hello!");
	});

	it("converts tool calls to function_call outputs", () => {
		const chatResponse = {
			choices: [
				{
					message: {
						role: "assistant",
						content: null,
						tool_calls: [
							{
								id: "call_abc",
								type: "function",
								function: {
									name: "get_weather",
									arguments: '{"location": "SF"}',
								},
							},
						],
					},
					finish_reason: "tool_calls",
				},
			],
			usage: {
				prompt_tokens: 20,
				completion_tokens: 10,
				total_tokens: 30,
			},
		};

		const result = convertChatResponseToResponses(chatResponse, "gpt-4o-mini");

		const functionCall = result.output.find((o) => o.type === "function_call");
		expect(functionCall).toBeDefined();
		expect((functionCall as any).call_id).toBe("call_abc");
		expect((functionCall as any).name).toBe("get_weather");
		expect(result.status).toBe("completed");
	});

	it("sets status to incomplete on length finish_reason", () => {
		const chatResponse = {
			choices: [
				{
					message: { role: "assistant", content: "Truncated..." },
					finish_reason: "length",
				},
			],
			usage: {
				prompt_tokens: 10,
				completion_tokens: 100,
				total_tokens: 110,
			},
		};

		const result = convertChatResponseToResponses(chatResponse, "gpt-4o-mini");

		expect(result.status).toBe("incomplete");
	});

	it("includes reasoning output when present", () => {
		const chatResponse = {
			choices: [
				{
					message: {
						role: "assistant",
						content: "The answer is 42",
						reasoning: "Let me think step by step...",
					},
					finish_reason: "stop",
				},
			],
			usage: {
				prompt_tokens: 10,
				completion_tokens: 50,
				total_tokens: 60,
			},
		};

		const result = convertChatResponseToResponses(chatResponse, "gpt-4o-mini");

		const reasoning = result.output.find((o) => o.type === "reasoning");
		expect(reasoning).toBeDefined();
		expect((reasoning as any).summary[0].text).toBe(
			"Let me think step by step...",
		);
	});

	it("passes through cost fields", () => {
		const chatResponse = {
			choices: [
				{
					message: { role: "assistant", content: "Hi" },
					finish_reason: "stop",
				},
			],
			usage: {
				prompt_tokens: 10,
				completion_tokens: 5,
				total_tokens: 15,
				cost_usd_total: 0.001,
				cost_usd_input: 0.0005,
				cost_usd_output: 0.0005,
			},
		};

		const result = convertChatResponseToResponses(chatResponse, "gpt-4o-mini");

		expect(result.usage.cost_usd_total).toBe(0.001);
		expect(result.usage.cost_usd_input).toBe(0.0005);
	});
});

describe("streaming conversion", () => {
	it("creates a response.created event", () => {
		const state = createStreamingState("gpt-4o-mini");
		const event = createResponseCreatedEvent(state);

		expect(event.event).toBe("response.created");
		const data = JSON.parse(event.data);
		expect(data.type).toBe("response.created");
		expect(data.response.id).toMatch(/^resp_/);
		expect(data.response.status).toBe("in_progress");
	});

	it("processes content delta", () => {
		const state = createStreamingState("gpt-4o-mini");
		const chunk = {
			choices: [{ delta: { content: "Hello" } }],
		};

		const events = processStreamChunk(chunk, state);

		// Should emit output_item.added, content_part.added, and output_text.delta
		expect(events.length).toBeGreaterThanOrEqual(3);
		expect(events.some((e) => e.event === "response.output_item.added")).toBe(
			true,
		);
		expect(events.some((e) => e.event === "response.content_part.added")).toBe(
			true,
		);
		expect(events.some((e) => e.event === "response.output_text.delta")).toBe(
			true,
		);

		const deltaEvent = events.find(
			(e) => e.event === "response.output_text.delta",
		);
		const deltaData = JSON.parse(deltaEvent!.data);
		expect(deltaData.delta).toBe("Hello");
	});

	it("only emits output_item.added once", () => {
		const state = createStreamingState("gpt-4o-mini");

		processStreamChunk({ choices: [{ delta: { content: "Hello" } }] }, state);
		const events2 = processStreamChunk(
			{ choices: [{ delta: { content: " world" } }] },
			state,
		);

		// Second chunk should only have delta event
		expect(events2).toHaveLength(1);
		expect(events2[0]!.event).toBe("response.output_text.delta");
	});

	it("creates completion events", () => {
		const state = createStreamingState("gpt-4o-mini");
		processStreamChunk({ choices: [{ delta: { content: "Hello" } }] }, state);

		const events = createCompletionEvents(state);

		expect(events.some((e) => e.event === "response.output_text.done")).toBe(
			true,
		);
		expect(events.some((e) => e.event === "response.completed")).toBe(true);

		const completedEvent = events.find((e) => e.event === "response.completed");
		const completedData = JSON.parse(completedEvent!.data);
		expect(completedData.response.status).toBe("completed");
	});

	it("uses consistent IDs across streaming events", () => {
		const state = createStreamingState("gpt-4o-mini");
		const events1 = processStreamChunk(
			{ choices: [{ delta: { content: "Hello" } }] },
			state,
		);
		const completionEvents = createCompletionEvents(state);

		const addedEvent = events1.find(
			(e) => e.event === "response.output_item.added",
		);
		const addedData = JSON.parse(addedEvent!.data);
		const addedId = addedData.item.id;

		const doneEvent = completionEvents.find(
			(e) => e.event === "response.output_item.done",
		);
		const doneData = JSON.parse(doneEvent!.data);

		const completedEvent = completionEvents.find(
			(e) => e.event === "response.completed",
		);
		const completedData = JSON.parse(completedEvent!.data);
		const completedMsgId = completedData.response.output.find(
			(o: Record<string, unknown>) => o.type === "message",
		)?.id;

		expect(doneData.item.id).toBe(addedId);
		expect(completedMsgId).toBe(addedId);
	});

	it("emits output_item.done for function_call items", () => {
		const state = createStreamingState("gpt-4o-mini");
		processStreamChunk(
			{
				choices: [
					{
						delta: {
							tool_calls: [
								{
									index: 0,
									id: "call_abc",
									function: { name: "get_weather", arguments: '{"loc":"SF"}' },
								},
							],
						},
					},
				],
			},
			state,
		);

		const events = createCompletionEvents(state);
		const fcDone = events.find(
			(e) =>
				e.event === "response.output_item.done" &&
				JSON.parse(e.data).item.type === "function_call",
		);
		expect(fcDone).toBeDefined();
		expect(JSON.parse(fcDone!.data).item.name).toBe("get_weather");
	});

	it("maps length finish_reason to incomplete status in streaming", () => {
		const state = createStreamingState("gpt-4o-mini");
		processStreamChunk(
			{ choices: [{ delta: { content: "Hello" }, finish_reason: "length" }] },
			state,
		);

		const events = createCompletionEvents(state);
		const completedEvent = events.find((e) => e.event === "response.completed");
		const completedData = JSON.parse(completedEvent!.data);
		expect(completedData.response.status).toBe("incomplete");
	});

	it("creates a response.failed event", () => {
		const state = createStreamingState("gpt-4o-mini");
		const event = createFailedEvent(state);

		expect(event.event).toBe("response.failed");
		const data = JSON.parse(event.data);
		expect(data.type).toBe("response.failed");
		expect(data.response.status).toBe("failed");
		expect(data.response.id).toBe(state.responseId);
	});
});
