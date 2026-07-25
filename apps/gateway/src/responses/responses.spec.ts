import { describe, it, expect, vi } from "vitest";

import { responsesRequestSchema } from "./schemas.js";
import { convertChatResponseToResponses } from "./tools/convert-chat-to-responses.js";
import { convertResponsesInputToMessages } from "./tools/convert-responses-to-chat.js";
import {
	createStreamingState,
	createResponseCreatedEvent,
	processStreamChunk,
	createCompletionEvents,
	createFailedEvent,
} from "./tools/convert-streaming-to-responses.js";
import { resolveItemReferences } from "./tools/response-state.js";

vi.mock("@llmgateway/db", async (importOriginal) => {
	const actual = await importOriginal<Record<string, unknown>>();
	return {
		...actual,
		db: {
			select: vi.fn().mockReturnValue({
				from: vi.fn().mockReturnValue({
					where: vi.fn().mockReturnValue({
						limit: vi.fn().mockResolvedValue([]),
						orderBy: vi.fn().mockReturnValue({
							limit: vi.fn().mockResolvedValue([]),
						}),
					}),
				}),
			}),
			update: vi.fn().mockReturnValue({
				set: vi.fn().mockReturnValue({
					where: vi.fn().mockResolvedValue(undefined),
				}),
			}),
		},
	};
});

const redisGet = vi.fn();
vi.mock("@llmgateway/cache", () => ({
	redisClient: {
		get: (...args: unknown[]) => redisGet(...args),
		set: vi.fn().mockResolvedValue("OK"),
	},
}));

vi.mock("@llmgateway/logger", () => ({
	logger: {
		warn: vi.fn(),
		error: vi.fn(),
	},
}));

describe("responsesRequestSchema", () => {
	it("accepts reasoning items with function call outputs", () => {
		const result = responsesRequestSchema.safeParse({
			model: "gpt-5.3-codex",
			input: [
				{
					type: "reasoning",
					id: "rs_123",
					summary: [],
				},
				{
					type: "function_call",
					call_id: "call_123",
					name: "view_image",
					arguments: '{"path":"/tmp/a.png"}',
				},
				{
					type: "function_call_output",
					call_id: "call_123",
					output: "tool result",
				},
			],
		});

		expect(result.success).toBe(true);
	});

	it("accepts structured function call outputs", () => {
		const result = responsesRequestSchema.safeParse({
			model: "gpt-5.3-codex",
			input: [
				{
					type: "function_call_output",
					call_id: "call_123",
					output: [
						{
							type: "input_text",
							text: "tool failed: invalid image path",
						},
					],
				},
			],
		});

		expect(result.success).toBe(true);
	});

	it('preserves reasoning.effort "max" so it is forwarded to the provider as-is', () => {
		const result = responsesRequestSchema.safeParse({
			model: "deepseek-v4",
			input: "hello",
			reasoning: { effort: "max" },
		});

		expect(result.success).toBe(true);
		expect(result.data?.reasoning?.effort).toBe("max");
	});

	it("accepts service_tier and normalizes explicit null to undefined", () => {
		const withTier = responsesRequestSchema.safeParse({
			model: "gpt-5.5",
			input: "hello",
			service_tier: "flex",
		});
		expect(withTier.success).toBe(true);
		expect(withTier.data?.service_tier).toBe("flex");

		const withNull = responsesRequestSchema.safeParse({
			model: "gpt-5.5",
			input: "hello",
			service_tier: null,
		});
		expect(withNull.success).toBe(true);
		expect(withNull.data?.service_tier).toBeUndefined();

		const invalid = responsesRequestSchema.safeParse({
			model: "gpt-5.5",
			input: "hello",
			service_tier: "turbo",
		});
		expect(invalid.success).toBe(false);
	});

	it("accepts item_reference items mixed with messages and outputs", () => {
		const result = responsesRequestSchema.safeParse({
			model: "gpt-5.5",
			input: [
				{ role: "developer", content: "be helpful" },
				{ role: "user", content: "hi" },
				{ type: "item_reference", id: "fc_97KANutVc7ZxBoNerPUN1FE2" },
				{
					type: "function_call_output",
					call_id: "call_rvsx8tvgGBCjGB8HitLxPG1F",
					output: "done",
				},
			],
		});

		expect(result.success).toBe(true);
	});
});

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

	it("stringifies structured function_call_output for tool messages", () => {
		const input = [
			{
				type: "function_call_output" as const,
				call_id: "call_123",
				output: [
					{
						type: "input_text" as const,
						text: "tool failed: invalid image path",
					},
				],
			},
		];
		const result = convertResponsesInputToMessages(input);
		expect(result).toEqual([
			{
				role: "tool",
				content: JSON.stringify([
					{
						type: "input_text",
						text: "tool failed: invalid image path",
					},
				]),
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

	it("skips reasoning items from stored output", () => {
		// Reasoning items appear in stored output when chaining via previous_response_id.
		// The function should skip them since they can't be converted to chat messages.
		const input = [
			{
				type: "reasoning",
				id: "rs_123",
				summary: [{ type: "summary_text", text: "thinking..." }],
			},
			{ role: "assistant" as const, content: "The answer is 42" },
			{ role: "user" as const, content: "Thanks" },
		] as unknown[];
		const result = convertResponsesInputToMessages(
			input as Parameters<typeof convertResponsesInputToMessages>[0],
		);
		expect(result).toHaveLength(2);
		expect(result[0]!.role).toBe("assistant");
		expect(result[0]!.content).toBe("The answer is 42");
		expect(result[1]!.role).toBe("user");
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
		expect(result.usage!.input_tokens).toBe(10);
		expect(result.usage!.output_tokens).toBe(5);

		const messageOutput = result.output.find((o) => o.type === "message");
		expect(messageOutput).toBeDefined();
		expect((messageOutput as any).content[0].type).toBe("output_text");
		expect((messageOutput as any).content[0].text).toBe("Hello!");
	});

	it("echoes the served service tier from the chat response", () => {
		const chatResponse = {
			choices: [
				{
					message: { role: "assistant", content: "Hi" },
					finish_reason: "stop",
				},
			],
			usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
			service_tier: "flex",
		};

		const result = convertChatResponseToResponses(
			chatResponse,
			"openai/gpt-5.5",
			undefined,
			{ service_tier: "flex" },
		);

		expect(result.service_tier).toBe("flex");
	});

	it("falls back to metadata used_service_tier, then the requested tier", () => {
		const baseChat = {
			choices: [
				{
					message: { role: "assistant", content: "Hi" },
					finish_reason: "stop",
				},
			],
			usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
		};

		// A downgraded premium request echoes the tier actually served.
		const downgraded = convertChatResponseToResponses(
			{
				...baseChat,
				metadata: { requested_service_tier: "flex", used_service_tier: null },
			},
			"google-vertex/gemini-3-pro",
			undefined,
			{ service_tier: "flex" },
		);
		expect(downgraded.service_tier).toBe("default");

		const served = convertChatResponseToResponses(
			{
				...baseChat,
				metadata: {
					requested_service_tier: "flex",
					used_service_tier: "flex",
				},
			},
			"google-vertex/gemini-3-pro",
			undefined,
			{ service_tier: "flex" },
		);
		expect(served.service_tier).toBe("flex");

		// Without tier info from the chat response, echo the requested tier.
		const requestedOnly = convertChatResponseToResponses(
			baseChat,
			"openai/gpt-5.5",
			undefined,
			{ service_tier: "priority" },
		);
		expect(requestedOnly.service_tier).toBe("priority");
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

	it("uses provided responseId when given", () => {
		const chatResponse = {
			choices: [
				{
					message: { role: "assistant", content: "Hi" },
					finish_reason: "stop",
				},
			],
			usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
		};

		const result = convertChatResponseToResponses(
			chatResponse,
			"gpt-4o-mini",
			"resp_custom_id_123",
		);

		expect(result.id).toBe("resp_custom_id_123");
	});

	it("generates responseId when not provided", () => {
		const chatResponse = {
			choices: [
				{
					message: { role: "assistant", content: "Hi" },
					finish_reason: "stop",
				},
			],
			usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
		};

		const result = convertChatResponseToResponses(chatResponse, "gpt-4o-mini");
		expect(result.id).toMatch(/^resp_/);
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
				cost: 0.001,
				cost_details: {
					upstream_inference_cost: 0.001,
					upstream_inference_prompt_cost: 0.0005,
					upstream_inference_completions_cost: 0.0005,
					total_cost: 0.001,
					input_cost: 0.0005,
					output_cost: 0.0005,
					cached_input_cost: 0,
					request_cost: 0,
					web_search_cost: 0,
					image_input_cost: null,
					image_output_cost: null,
					data_storage_cost: 0.00000015,
				},
			},
		};

		const result = convertChatResponseToResponses(chatResponse, "gpt-4o-mini");

		expect(result.usage!.cost).toBe(0.001);
		expect(result.usage!.cost_details).toEqual({
			upstream_inference_cost: 0.001,
			upstream_inference_prompt_cost: 0.0005,
			upstream_inference_completions_cost: 0.0005,
			total_cost: 0.001,
			input_cost: 0.0005,
			output_cost: 0.0005,
			cached_input_cost: 0,
			request_cost: 0,
			web_search_cost: 0,
			image_input_cost: null,
			image_output_cost: null,
			data_storage_cost: 0.00000015,
		});
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

	it("captures the served service tier from stream chunks", () => {
		const state = createStreamingState("gpt-5.5", undefined, {
			service_tier: "flex",
		});
		processStreamChunk({ choices: [{ delta: { content: "Hello" } }] }, state);
		processStreamChunk(
			{
				choices: [],
				usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
				service_tier: "flex",
			},
			state,
		);

		const events = createCompletionEvents(state);
		const completedEvent = events.find((e) => e.event === "response.completed");
		const completedData = JSON.parse(completedEvent!.data);
		expect(completedData.response.service_tier).toBe("flex");
	});

	it("captures a downgraded tier from the final usage chunk metadata", () => {
		const state = createStreamingState("gemini-3-pro", undefined, {
			service_tier: "flex",
		});
		processStreamChunk({ choices: [{ delta: { content: "Hello" } }] }, state);
		processStreamChunk(
			{
				choices: [],
				usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
				metadata: { requested_service_tier: "flex", used_service_tier: null },
			},
			state,
		);

		const events = createCompletionEvents(state);
		const completedEvent = events.find((e) => e.event === "response.completed");
		const completedData = JSON.parse(completedEvent!.data);
		expect(completedData.response.service_tier).toBe("default");
	});

	it("echoes the requested service tier when no served tier is reported", () => {
		const state = createStreamingState("gpt-5.5", undefined, {
			service_tier: "priority",
		});
		processStreamChunk({ choices: [{ delta: { content: "Hello" } }] }, state);

		const events = createCompletionEvents(state);
		const completedEvent = events.find((e) => e.event === "response.completed");
		const completedData = JSON.parse(completedEvent!.data);
		expect(completedData.response.service_tier).toBe("priority");
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

	it("gives the message and a following tool call distinct output_index values", () => {
		const state = createStreamingState("gpt-4o-mini");
		const contentEvents = processStreamChunk(
			{ choices: [{ delta: { content: "Let me check" } }] },
			state,
		);
		const toolEvents = processStreamChunk(
			{
				choices: [
					{
						delta: {
							tool_calls: [
								{
									index: 0,
									id: "call_1",
									function: { name: "get_weather", arguments: "{}" },
								},
							],
						},
					},
				],
			},
			state,
		);

		const msgAdded = JSON.parse(
			contentEvents.find(
				(e) =>
					e.event === "response.output_item.added" &&
					JSON.parse(e.data).item.type === "message",
			)!.data,
		);
		const fcAdded = JSON.parse(
			toolEvents.find(
				(e) =>
					e.event === "response.output_item.added" &&
					JSON.parse(e.data).item.type === "function_call",
			)!.data,
		);
		expect(msgAdded.output_index).not.toBe(fcAdded.output_index);

		const events = createCompletionEvents(state);
		const msgDone = JSON.parse(
			events.find(
				(e) =>
					e.event === "response.output_item.done" &&
					JSON.parse(e.data).item.type === "message",
			)!.data,
		);
		// The message keeps the same output_index across added and done.
		expect(msgDone.output_index).toBe(msgAdded.output_index);

		// The final output array is ordered by output_index (message before tool).
		const completed = JSON.parse(
			events.find((e) => e.event === "response.completed")!.data,
		);
		const types = completed.response.output.map(
			(o: Record<string, unknown>) => o.type,
		);
		expect(types).toEqual(["message", "function_call"]);
	});

	it("gives reasoning and a following message distinct output_index values", () => {
		const state = createStreamingState("gpt-4o-mini");
		const reasoningEvents = processStreamChunk(
			{ choices: [{ delta: { reasoning: "let me think" } }] },
			state,
		);
		const contentEvents = processStreamChunk(
			{ choices: [{ delta: { content: "Here is the answer" } }] },
			state,
		);

		const reasoningAdded = JSON.parse(
			reasoningEvents.find(
				(e) =>
					e.event === "response.output_item.added" &&
					JSON.parse(e.data).item.type === "reasoning",
			)!.data,
		);
		const msgAdded = JSON.parse(
			contentEvents.find(
				(e) =>
					e.event === "response.output_item.added" &&
					JSON.parse(e.data).item.type === "message",
			)!.data,
		);
		expect(reasoningAdded.output_index).not.toBe(msgAdded.output_index);

		const events = createCompletionEvents(state);
		const completed = JSON.parse(
			events.find((e) => e.event === "response.completed")!.data,
		);
		const types = completed.response.output.map(
			(o: Record<string, unknown>) => o.type,
		);
		expect(types).toEqual(["reasoning", "message"]);
	});

	it("keeps tool-call output_index aligned when reasoning precedes multi-chunk tool calls", () => {
		const state = createStreamingState("gpt-4o-mini");
		processStreamChunk(
			{ choices: [{ delta: { reasoning: "thinking" } }] },
			state,
		);
		// First tool call opens.
		processStreamChunk(
			{
				choices: [
					{
						delta: {
							tool_calls: [
								{
									index: 0,
									id: "call_a",
									function: { name: "get_weather", arguments: "" },
								},
							],
						},
					},
				],
			},
			state,
		);
		// Extra argument chunk for the same tool call — previously this
		// bumped the shared index on every chunk, inflating later slots.
		processStreamChunk(
			{
				choices: [
					{
						delta: {
							tool_calls: [
								{ index: 0, function: { arguments: '{"city":"NYC"}' } },
							],
						},
					},
				],
			},
			state,
		);
		// Second tool call opens.
		const secondToolEvents = processStreamChunk(
			{
				choices: [
					{
						delta: {
							tool_calls: [
								{
									index: 1,
									id: "call_b",
									function: { name: "get_time", arguments: "{}" },
								},
							],
						},
					},
				],
			},
			state,
		);

		const secondAdded = JSON.parse(
			secondToolEvents.find(
				(e) =>
					e.event === "response.output_item.added" &&
					JSON.parse(e.data).item.type === "function_call",
			)!.data,
		);

		const events = createCompletionEvents(state);
		const completed = JSON.parse(
			events.find((e) => e.event === "response.completed")!.data,
		);
		const output = completed.response.output as Record<string, unknown>[];

		// The streamed output_index for the second tool call must match its
		// position in the final, index-sorted response.output array.
		const finalPos = output.findIndex(
			(o) => o.type === "function_call" && o.name === "get_time",
		);
		expect(secondAdded.output_index).toBe(finalPos);

		const types = output.map((o) => o.type);
		expect(types).toEqual(["reasoning", "function_call", "function_call"]);
	});

	it("emits annotation events with the message's output_index", () => {
		const state = createStreamingState("gpt-4o-mini");
		const contentEvents = processStreamChunk(
			{ choices: [{ delta: { content: "According to the docs" } }] },
			state,
		);
		const annotationEvents = processStreamChunk(
			{
				choices: [
					{
						delta: {
							annotations: [
								{
									type: "url_citation",
									url_citation: {
										url: "https://example.com",
										title: "Example",
										start_index: 0,
										end_index: 10,
									},
								},
							],
						},
					},
				],
			},
			state,
		);

		const msgAdded = JSON.parse(
			contentEvents.find(
				(e) =>
					e.event === "response.output_item.added" &&
					JSON.parse(e.data).item.type === "message",
			)!.data,
		);
		const annAdded = JSON.parse(
			annotationEvents.find(
				(e) => e.event === "response.output_text.annotation.added",
			)!.data,
		);
		expect(annAdded.output_index).toBe(msgAdded.output_index);
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

describe("resolveItemReferences", () => {
	const storedFunctionCall = {
		type: "function_call",
		id: "fc_97KANutVc7ZxBoNerPUN1FE2",
		call_id: "call_rvsx8tvgGBCjGB8HitLxPG1F",
		name: "view_image",
		arguments: '{"path":"/tmp/a.png"}',
		status: "completed",
	};

	it("returns input unchanged when there are no item_reference items", async () => {
		const input = [
			{ role: "user", content: "hi" },
			{ type: "function_call_output", call_id: "call_1", output: "done" },
		];
		const result = await resolveItemReferences(input, "project_1");
		expect(result).toBe(input);
		expect(redisGet).not.toHaveBeenCalled();
	});

	it("replaces an item_reference with the resolved stored item", async () => {
		redisGet.mockResolvedValueOnce(JSON.stringify(storedFunctionCall));
		const input = [
			{ role: "developer", content: "be helpful" },
			{ role: "user", content: "hi" },
			{ type: "item_reference", id: "fc_97KANutVc7ZxBoNerPUN1FE2" },
			{
				type: "function_call_output",
				call_id: "call_rvsx8tvgGBCjGB8HitLxPG1F",
				output: "done",
			},
		];

		const resolved = await resolveItemReferences(input, "project_1");

		expect(resolved[2]).toEqual(storedFunctionCall);

		// The resolved function_call must convert into an assistant tool_calls
		// message that precedes the tool result, otherwise strict providers reject
		// the orphaned tool message.
		const messages = convertResponsesInputToMessages(
			resolved as Parameters<typeof convertResponsesInputToMessages>[0],
		);
		const assistantIdx = messages.findIndex((m) => m.role === "assistant");
		const toolIdx = messages.findIndex((m) => m.role === "tool");
		expect(assistantIdx).toBeGreaterThanOrEqual(0);
		expect(toolIdx).toBeGreaterThan(assistantIdx);
		expect(messages[assistantIdx]!.tool_calls).toEqual([
			{
				id: "call_rvsx8tvgGBCjGB8HitLxPG1F",
				type: "function",
				function: {
					name: "view_image",
					arguments: '{"path":"/tmp/a.png"}',
				},
			},
		]);
	});

	it("drops item_reference items that cannot be resolved", async () => {
		redisGet.mockResolvedValueOnce(null);
		const input = [
			{ role: "user", content: "hi" },
			{ type: "item_reference", id: "fc_missing" },
		];

		const resolved = await resolveItemReferences(input, "project_1");

		expect(resolved).toEqual([{ role: "user", content: "hi" }]);
	});
});
