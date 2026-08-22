import { describe, it, expect, vi } from "vitest";

import { responsesRequestSchema } from "./schemas.js";
import {
	convertChatResponseToResponses,
	stripEncryptedReasoningContent,
} from "./tools/convert-chat-to-responses.js";
import { convertResponsesInputToMessages } from "./tools/convert-responses-to-chat.js";
import {
	createStreamingState,
	createResponseCreatedEvent,
	processStreamChunk,
	createCompletionEvents,
	createFailedEvent,
	buildFinalOutputItems,
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
		get: vi.fn(),
		set: vi.fn().mockResolvedValue("OK"),
	},
	storageRedisClient: {
		get: (...args: unknown[]) => redisGet(...args),
		set: vi.fn().mockResolvedValue("OK"),
		mget: vi.fn().mockResolvedValue([]),
		pipeline: vi.fn(() => ({
			set: vi.fn(),
			exec: vi.fn().mockResolvedValue([]),
		})),
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

	it("accepts both the Responses and Chat Completions tool_choice shapes", () => {
		// The Responses API nests nothing: `{type:"function",name}`. Clients that
		// port a chat-completions payload over send the nested form instead, and
		// both have to get through.
		const responsesShape = responsesRequestSchema.safeParse({
			model: "gpt-5.6-sol",
			input: "hi",
			tool_choice: { type: "function", name: "get_weather" },
		});
		expect(responsesShape.success).toBe(true);

		const chatShape = responsesRequestSchema.safeParse({
			model: "gpt-5.6-sol",
			input: "hi",
			tool_choice: { type: "function", function: { name: "get_weather" } },
		});
		expect(chatShape.success).toBe(true);
	});

	it("accepts reasoning items whose optional fields are explicit nulls", () => {
		// Codex replays the whole prior output as `input` and serializes its
		// absent optionals as nulls, so a reasoning item the gateway itself
		// emitted comes back with `content: null`.
		const result = responsesRequestSchema.safeParse({
			model: "gpt-5.5",
			store: false,
			include: ["reasoning.encrypted_content"],
			input: [
				{
					type: "reasoning",
					id: null,
					summary: [{ type: "summary_text", text: "**Planning**" }],
					content: null,
					encrypted_content: "gAAAAAB_encrypted_payload",
					status: null,
				},
				{ role: "user", content: "continue" },
			],
		});

		expect(result.success).toBe(true);
		const reasoningItem = (
			result.data!.input as Array<Record<string, unknown>>
		)[0]!;
		// Nulls normalize to undefined so downstream conversion is unchanged.
		expect(reasoningItem.content).toBeUndefined();
		expect(reasoningItem.id).toBeUndefined();
		expect(reasoningItem.status).toBeUndefined();
		expect(reasoningItem.encrypted_content).toBe("gAAAAAB_encrypted_payload");
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

	it("accepts include with reasoning.encrypted_content", () => {
		const result = responsesRequestSchema.safeParse({
			model: "gpt-5.5",
			input: "hello",
			store: false,
			include: ["reasoning.encrypted_content"],
		});

		expect(result.success).toBe(true);
		expect(result.data?.include).toEqual(["reasoning.encrypted_content"]);
	});

	it("normalizes include null to undefined", () => {
		const result = responsesRequestSchema.safeParse({
			model: "gpt-5.5",
			input: "hello",
			include: null,
		});

		expect(result.success).toBe(true);
		expect(result.data?.include).toBeUndefined();
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
			{ type: "message" as const, role: "user" as const, content: "Hello" },
			{
				type: "message" as const,
				role: "assistant" as const,
				content: "Hi there",
			},
		];
		const result = convertResponsesInputToMessages(input);
		expect(result).toHaveLength(2);
		expect(result[0]!.role).toBe("user");
		expect(result[0]!.content).toBe("Hello");
		expect(result[1]!.role).toBe("assistant");
		expect(result[1]!.content).toBe("Hi there");
	});

	it("keeps an explicit prompt cache breakpoint on a replayed output_text part", () => {
		// Only a marker that survives request validation can reach the provider,
		// so this goes through the schema the route parses with. The sibling
		// `text` part is the control: both carry the same marker.
		const req = responsesRequestSchema.parse({
			model: "gpt-5.6-sol",
			prompt_cache_options: { mode: "explicit" },
			input: [
				{
					role: "assistant",
					content: [
						{
							type: "output_text",
							text: "prior answer",
							prompt_cache_breakpoint: { mode: "explicit" },
						},
					],
				},
				{
					role: "assistant",
					content: [
						{
							type: "text",
							text: "prior answer",
							prompt_cache_breakpoint: { mode: "explicit" },
						},
					],
				},
			],
		});

		const messages = convertResponsesInputToMessages(req.input);
		const expected = [
			{
				type: "text",
				text: "prior answer",
				prompt_cache_breakpoint: { mode: "explicit" },
			},
		];

		expect(messages[0]!.content).toEqual(expected);
		expect(messages[1]!.content).toEqual(expected);
	});

	it("converts function_call items to assistant tool_calls", () => {
		const input = [
			{
				type: "message" as const,
				role: "user" as const,
				content: "What's the weather?",
			},
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
				type: "message" as const,
				role: "user" as const,
				content: [{ type: "input_text" as const, text: "Hello" }],
			},
		];
		const result = convertResponsesInputToMessages(input);
		expect(result[0]!.content).toEqual([{ type: "text", text: "Hello" }]);
	});

	it("maps developer role to system", () => {
		const input = [
			{
				type: "message" as const,
				role: "developer" as const,
				content: "You are helpful",
			},
			{ type: "message" as const, role: "user" as const, content: "Hello" },
		];
		const result = convertResponsesInputToMessages(input);
		expect(result[0]!.role).toBe("system");
		expect(result[0]!.content).toBe("You are helpful");
	});

	it("attaches reasoning summary text to the following assistant message", () => {
		// Reasoning items appear in stored output when chaining via previous_response_id.
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
		expect(result[0]!.reasoning).toBe("thinking...");
		expect(result[0]!.reasoning_details).toBeUndefined();
		expect(result[1]!.role).toBe("user");
	});

	it("attaches encrypted reasoning to the assistant tool_calls message", () => {
		const input = [
			{ role: "user" as const, content: "What's the weather?" },
			{
				type: "reasoning",
				id: "rs_abc",
				summary: [],
				encrypted_content: "gAAAA-encrypted-blob",
			},
			{
				type: "function_call" as const,
				call_id: "call_123",
				name: "get_weather",
				arguments: '{"location": "SF"}',
			},
			{
				type: "function_call_output" as const,
				call_id: "call_123",
				output: '{"temp": 72}',
			},
		] as unknown[];
		const result = convertResponsesInputToMessages(
			input as Parameters<typeof convertResponsesInputToMessages>[0],
		);
		expect(result).toHaveLength(3);
		expect(result[1]!.role).toBe("assistant");
		expect(result[1]!.tool_calls).toHaveLength(1);
		expect(result[1]!.reasoning_details).toEqual([
			{
				type: "reasoning.encrypted",
				data: "gAAAA-encrypted-blob",
				id: "rs_abc",
				format: "openai-responses-v1",
				index: 0,
			},
		]);
		expect(result[2]!.role).toBe("tool");
	});

	it("preserves the phase of a folded trailing assistant message", () => {
		const input = [
			{
				type: "function_call" as const,
				call_id: "call_123",
				name: "get_weather",
				arguments: '{"location": "SF"}',
			},
			{
				type: "message" as const,
				role: "assistant" as const,
				phase: "commentary" as const,
				content: [{ type: "output_text" as const, text: "Checking..." }],
			},
			{
				type: "function_call_output" as const,
				call_id: "call_123",
				output: '{"temp": 72}',
			},
		] as unknown[];
		const result = convertResponsesInputToMessages(
			input as Parameters<typeof convertResponsesInputToMessages>[0],
		);
		expect(result).toHaveLength(2);
		expect(result[0]!.role).toBe("assistant");
		expect(result[0]!.tool_calls).toHaveLength(1);
		expect(result[0]!.content).toBe("Checking...");
		expect(result[0]!.phase).toBe("commentary");
		expect(result[1]!.role).toBe("tool");
	});

	it("emits an assistant carrier for encrypted reasoning followed by a user item (incomplete prior turn)", () => {
		const input = [
			{
				type: "reasoning",
				id: "rs_orphan",
				summary: [{ type: "summary_text", text: "stale thinking" }],
				encrypted_content: "gAAAA-stale",
			},
			{ role: "user" as const, content: "New question" },
			{ role: "assistant" as const, content: "Answer" },
		] as unknown[];
		const result = convertResponsesInputToMessages(
			input as Parameters<typeof convertResponsesInputToMessages>[0],
		);
		expect(result).toHaveLength(3);
		expect(result[0]!.role).toBe("assistant");
		expect(result[0]!.content).toBeNull();
		expect(result[0]!.reasoning_details).toEqual([
			{
				type: "reasoning.encrypted",
				data: "gAAAA-stale",
				id: "rs_orphan",
				format: "openai-responses-v1",
				index: 0,
			},
		]);
		expect(result[1]!.role).toBe("user");
		expect(result[2]!.role).toBe("assistant");
		expect(result[2]!.reasoning).toBeUndefined();
		expect(result[2]!.reasoning_details).toBeUndefined();
	});

	it("drops buffered text-only reasoning when no assistant item follows it", () => {
		const input = [
			{
				type: "reasoning",
				id: "rs_orphan",
				summary: [{ type: "summary_text", text: "stale thinking" }],
			},
			{ role: "user" as const, content: "New question" },
			{ role: "assistant" as const, content: "Answer" },
		] as unknown[];
		const result = convertResponsesInputToMessages(
			input as Parameters<typeof convertResponsesInputToMessages>[0],
		);
		expect(result).toHaveLength(2);
		expect(result[1]!.role).toBe("assistant");
		expect(result[1]!.reasoning).toBeUndefined();
		expect(result[1]!.reasoning_details).toBeUndefined();
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

	it("sets status to incomplete on incomplete finish_reason (Responses API upstream truncation)", () => {
		const chatResponse = {
			choices: [
				{
					message: { role: "assistant", content: null },
					finish_reason: "incomplete",
				},
			],
			usage: {
				prompt_tokens: 10,
				completion_tokens: 16,
				total_tokens: 26,
			},
		};

		const result = convertChatResponseToResponses(chatResponse, "gpt-5.4");

		expect(result.status).toBe("incomplete");
		expect(result.incomplete_details).toEqual({
			reason: "max_output_tokens",
		});
		expect(result.completed_at).toBeNull();
	});

	it("sets status to incomplete with content_filter reason on content_filter finish_reason", () => {
		const chatResponse = {
			choices: [
				{
					message: { role: "assistant", content: "partial" },
					finish_reason: "content_filter",
				},
			],
			usage: {
				prompt_tokens: 10,
				completion_tokens: 5,
				total_tokens: 15,
			},
		};

		const result = convertChatResponseToResponses(chatResponse, "gpt-4o-mini");

		expect(result.status).toBe("incomplete");
		expect(result.incomplete_details).toEqual({ reason: "content_filter" });
	});

	it("emits pre-tool commentary before function_call items when marked", () => {
		const chatResponse = {
			choices: [
				{
					message: {
						role: "assistant",
						content: "Let me check the weather.",
						phase: "commentary",
						content_before_tool_calls: true,
						tool_calls: [
							{
								id: "call_1",
								type: "function",
								function: { name: "get_weather", arguments: "{}" },
							},
						],
					},
					finish_reason: "tool_calls",
				},
			],
			usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
		};

		const result = convertChatResponseToResponses(chatResponse, "gpt-5.6");

		expect(result.output.map((o) => o.type)).toEqual([
			"message",
			"function_call",
		]);
		expect(result.output[0]!.phase).toBe("commentary");
	});

	it("emits the message after function_call items by default", () => {
		const chatResponse = {
			choices: [
				{
					message: {
						role: "assistant",
						content: "Done.",
						tool_calls: [
							{
								id: "call_1",
								type: "function",
								function: { name: "get_weather", arguments: "{}" },
							},
						],
					},
					finish_reason: "tool_calls",
				},
			],
			usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
		};

		const result = convertChatResponseToResponses(chatResponse, "gpt-5.6");

		expect(result.output.map((o) => o.type)).toEqual([
			"function_call",
			"message",
		]);
	});

	it("reports the effective reasoning.context and never echoes auto", () => {
		const chatResponse = {
			choices: [
				{
					message: { role: "assistant", content: "Hi" },
					finish_reason: "stop",
				},
			],
			usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
		};

		// Effective value from the provider wins over the requested one.
		const effective = convertChatResponseToResponses(
			{ ...chatResponse, reasoning_context: "all_turns" },
			"gpt-5.6",
			undefined,
			{ reasoning: { effort: "high", context: "auto" } },
		);
		expect(effective.reasoning?.context).toBe("all_turns");

		// Requested "auto" without an effective value is omitted.
		const auto = convertChatResponseToResponses(
			chatResponse,
			"gpt-5.6",
			undefined,
			{ reasoning: { effort: "high", context: "auto" } },
		);
		expect(auto.reasoning?.context).toBeUndefined();
	});

	it("accepts reasoning.context auto in the request schema", () => {
		const result = responsesRequestSchema.safeParse({
			model: "gpt-5.6",
			input: "hello",
			reasoning: { context: "auto" },
		});
		expect(result.success).toBe(true);
		expect(result.data?.reasoning?.context).toBe("auto");
	});

	it("rebuilds separate phased message items in their original order", () => {
		const chatResponse = {
			choices: [
				{
					message: {
						role: "assistant",
						content: "Checking the weather.\n\nIt is sunny.",
						message_items: [
							{
								text: "Checking the weather.",
								phase: "commentary",
								preceding_tool_calls: 0,
							},
							{
								text: "It is sunny.",
								phase: "final_answer",
								preceding_tool_calls: 1,
							},
						],
						tool_calls: [
							{
								id: "call_1",
								type: "function",
								function: { name: "get_weather", arguments: "{}" },
							},
						],
					},
					finish_reason: "tool_calls",
				},
			],
			usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
		};

		const result = convertChatResponseToResponses(chatResponse, "gpt-5.6");

		expect(result.output.map((o) => o.type)).toEqual([
			"message",
			"function_call",
			"message",
		]);
		expect(result.output[0]!.phase).toBe("commentary");
		expect(
			(result.output[0]!.content as Array<{ text: string }>)[0]!.text,
		).toBe("Checking the weather.");
		expect(result.output[2]!.phase).toBe("final_answer");
		expect(
			(result.output[2]!.content as Array<{ text: string }>)[0]!.text,
		).toBe("It is sunny.");
	});

	it("reconstructs messages interleaved between multiple tool calls", () => {
		const chatResponse = {
			choices: [
				{
					message: {
						role: "assistant",
						content: "Commentary A\n\nCommentary B",
						message_items: [
							{
								text: "Commentary A",
								phase: "commentary",
								preceding_tool_calls: 0,
							},
							{
								text: "Commentary B",
								phase: "commentary",
								preceding_tool_calls: 1,
							},
						],
						tool_calls: [
							{
								id: "call_1",
								type: "function",
								function: { name: "tool_one", arguments: "{}" },
							},
							{
								id: "call_2",
								type: "function",
								function: { name: "tool_two", arguments: "{}" },
							},
						],
					},
					finish_reason: "tool_calls",
				},
			],
			usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
		};

		const result = convertChatResponseToResponses(chatResponse, "gpt-5.6");

		expect(
			result.output.map((o) =>
				o.type === "function_call"
					? (o.name as string)
					: (o.content as Array<{ text: string }>)[0]!.text,
			),
		).toEqual(["Commentary A", "tool_one", "Commentary B", "tool_two"]);
	});

	it("keeps a single message positioned between two tool calls", () => {
		const chatResponse = {
			choices: [
				{
					message: {
						role: "assistant",
						content: "Between the calls.",
						message_items: [
							{
								text: "Between the calls.",
								phase: "commentary",
								preceding_tool_calls: 1,
							},
						],
						tool_calls: [
							{
								id: "call_1",
								type: "function",
								function: { name: "tool_one", arguments: "{}" },
							},
							{
								id: "call_2",
								type: "function",
								function: { name: "tool_two", arguments: "{}" },
							},
						],
					},
					finish_reason: "tool_calls",
				},
			],
			usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
		};

		const result = convertChatResponseToResponses(chatResponse, "gpt-5.6");

		expect(
			result.output.map((o) =>
				o.type === "function_call"
					? (o.name as string)
					: (o.content as Array<{ text: string }>)[0]!.text,
			),
		).toEqual(["tool_one", "Between the calls.", "tool_two"]);
	});

	it("never reports a requested context the provider did not confirm", () => {
		const chatResponse = {
			choices: [
				{
					message: { role: "assistant", content: "Hi" },
					finish_reason: "stop",
				},
			],
			usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
		};

		// No upstream effective value (e.g. a non-OpenAI model that ignored the
		// setting): the requested value must not be echoed as if applied.
		const result = convertChatResponseToResponses(
			chatResponse,
			"claude-sonnet-5",
			undefined,
			{ reasoning: { effort: "high", context: "current_turn" } },
		);

		expect(result.reasoning).toEqual({ effort: "high", summary: null });
	});

	it("preserves the assistant-message phase on message output items", () => {
		const chatResponse = {
			choices: [
				{
					message: {
						role: "assistant",
						content: "The answer is 42",
						phase: "final_answer",
					},
					finish_reason: "stop",
				},
			],
			usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
		};

		const result = convertChatResponseToResponses(chatResponse, "gpt-5.6");

		const messageOutput = result.output.find((o) => o.type === "message");
		expect(messageOutput?.phase).toBe("final_answer");
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

	it("emits reasoning items with encrypted_content from reasoning_details", () => {
		const chatResponse = {
			choices: [
				{
					message: {
						role: "assistant",
						content: "The answer is 42",
						reasoning: "Let me think step by step...",
						reasoning_details: [
							{
								type: "reasoning.encrypted",
								data: "gAAAA-encrypted-blob",
								id: "rs_upstream",
								format: "openai-responses-v1",
								index: 0,
							},
						],
					},
					finish_reason: "stop",
				},
			],
			usage: { prompt_tokens: 10, completion_tokens: 50, total_tokens: 60 },
		};

		const result = convertChatResponseToResponses(chatResponse, "gpt-5.5");

		const reasoning = result.output.find((o) => o.type === "reasoning");
		expect(reasoning).toBeDefined();
		expect((reasoning as any).id).toBe("rs_upstream");
		expect((reasoning as any).encrypted_content).toBe("gAAAA-encrypted-blob");
		expect((reasoning as any).summary[0].text).toBe(
			"Let me think step by step...",
		);
	});

	it("excludes foreign-format encrypted details from encrypted_content", () => {
		const chatResponse = {
			choices: [
				{
					message: {
						role: "assistant",
						content: "The answer is 42",
						reasoning_details: [
							{
								type: "reasoning.encrypted",
								data: "foreign-blob",
								id: "rs_foreign",
								format: "anthropic-claude-v1",
								index: 0,
							},
						],
					},
					finish_reason: "stop",
				},
			],
			usage: { prompt_tokens: 10, completion_tokens: 50, total_tokens: 60 },
		};

		const result = convertChatResponseToResponses(chatResponse, "gpt-5.5");

		expect(
			result.output.some((o) => (o as any).encrypted_content !== undefined),
		).toBe(false);
	});

	it("strips encrypted_content via stripEncryptedReasoningContent", () => {
		const output = [
			{
				type: "reasoning",
				id: "rs_1",
				summary: [],
				encrypted_content: "gAAAA-secret",
			},
			{ type: "message", id: "msg_1", role: "assistant" },
		];

		const stripped = stripEncryptedReasoningContent(output);

		expect(stripped[0]).toEqual({ type: "reasoning", id: "rs_1", summary: [] });
		expect(stripped[1]).toBe(output[1]);
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

	it("uses the canonical model from streaming chat chunks", () => {
		const state = createStreamingState("deepseek-v4-flash");
		processStreamChunk(
			{
				model: "deepinfra/deepseek-v4-flash",
				choices: [{ delta: { content: "Hello" } }],
			},
			state,
		);

		const completed = createCompletionEvents(state);
		const data = JSON.parse(completed[completed.length - 1]!.data);
		expect(data.response.model).toBe("deepinfra/deepseek-v4-flash");
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

		// A summary-only reasoning item is announced lazily (when the next output
		// item starts), so its added event rides along with the message chunk.
		const findAdded = (type: string) =>
			JSON.parse(
				[...reasoningEvents, ...contentEvents].find(
					(e) =>
						e.event === "response.output_item.added" &&
						JSON.parse(e.data).item.type === type,
				)!.data,
			);
		const reasoningAdded = findAdded("reasoning");
		const msgAdded = findAdded("message");
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

	it("maps length finish_reason to a response.incomplete terminal event in streaming", () => {
		const state = createStreamingState("gpt-4o-mini");
		processStreamChunk(
			{ choices: [{ delta: { content: "Hello" }, finish_reason: "length" }] },
			state,
		);

		const events = createCompletionEvents(state);
		expect(
			events.find((e) => e.event === "response.completed"),
		).toBeUndefined();
		const terminalEvent = events.find((e) => e.event === "response.incomplete");
		expect(terminalEvent).toBeDefined();
		const terminalData = JSON.parse(terminalEvent!.data);
		expect(terminalData.type).toBe("response.incomplete");
		expect(terminalData.response.status).toBe("incomplete");
	});

	it("maps incomplete finish_reason (Responses API upstream) to a response.incomplete terminal event", () => {
		const state = createStreamingState("gpt-5.4");
		processStreamChunk(
			{ choices: [{ delta: {}, finish_reason: "incomplete" }] },
			state,
		);

		const events = createCompletionEvents(state);
		const terminalEvent = events.find((e) => e.event === "response.incomplete");
		expect(terminalEvent).toBeDefined();
		const terminalData = JSON.parse(terminalEvent!.data);
		expect(terminalData.response.status).toBe("incomplete");
		expect(terminalData.response.incomplete_details).toEqual({
			reason: "max_output_tokens",
		});
	});

	it("keeps stable output indices and order for pre-tool commentary followed by a tool call", () => {
		const state = createStreamingState("gpt-5.6");
		const addedEvents: Array<{ type: string; index: number }> = [];

		const collect = (events: Array<{ event: string; data: string }>) => {
			for (const e of events) {
				if (e.event === "response.output_item.added") {
					const parsed = JSON.parse(e.data);
					addedEvents.push({
						type: parsed.item.type,
						index: parsed.output_index,
					});
				}
			}
		};

		collect(
			processStreamChunk(
				{
					choices: [{ delta: { role: "assistant", phase: "commentary" } }],
				},
				state,
			),
		);
		collect(
			processStreamChunk(
				{ choices: [{ delta: { content: "Let me check." } }] },
				state,
			),
		);
		collect(
			processStreamChunk(
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
			),
		);
		processStreamChunk(
			{ choices: [{ delta: {}, finish_reason: "tool_calls" }] },
			state,
		);

		// Each item claims its own index, in stream order.
		expect(addedEvents).toEqual([
			{ type: "message", index: 0 },
			{ type: "function_call", index: 1 },
		]);

		const events = createCompletionEvents(state);
		const messageDone = events.find(
			(e) =>
				e.event === "response.output_item.done" &&
				JSON.parse(e.data).item.type === "message",
		);
		// The done event reuses the index from the added event.
		expect(JSON.parse(messageDone!.data).output_index).toBe(0);

		// Final output preserves the stream order: commentary before the call.
		const finalOutput = buildFinalOutputItems(state);
		expect(finalOutput.map((o) => o.type)).toEqual([
			"message",
			"function_call",
		]);
		expect(finalOutput[0]!.phase).toBe("commentary");
	});

	it("emits separate message items for commentary and final_answer phases in streaming", () => {
		const state = createStreamingState("gpt-5.6");
		const events: Array<{ event: string; data: string }> = [];

		events.push(
			...processStreamChunk(
				{ choices: [{ delta: { role: "assistant", phase: "commentary" } }] },
				state,
			),
			...processStreamChunk(
				{ choices: [{ delta: { content: "Checking the weather." } }] },
				state,
			),
			...processStreamChunk(
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
			),
			...processStreamChunk(
				{
					choices: [{ delta: { role: "assistant", phase: "final_answer" } }],
				},
				state,
			),
			...processStreamChunk(
				{ choices: [{ delta: { content: "It is sunny." } }] },
				state,
			),
			...processStreamChunk(
				{ choices: [{ delta: {}, finish_reason: "stop" }] },
				state,
			),
			...createCompletionEvents(state),
		);

		const added = events
			.filter((e) => e.event === "response.output_item.added")
			.map((e) => JSON.parse(e.data))
			.map((d) => ({
				type: d.item.type,
				index: d.output_index,
				phase: d.item.phase,
			}));
		expect(added).toEqual([
			{ type: "message", index: 0, phase: "commentary" },
			{ type: "function_call", index: 1, phase: undefined },
			{ type: "message", index: 2, phase: "final_answer" },
		]);

		// Each message item closes with its own id/index/text.
		const messageDones = events
			.filter(
				(e) =>
					e.event === "response.output_item.done" &&
					JSON.parse(e.data).item.type === "message",
			)
			.map((e) => JSON.parse(e.data));
		expect(messageDones).toHaveLength(2);
		expect(messageDones[0]!.output_index).toBe(0);
		expect(messageDones[0]!.item.phase).toBe("commentary");
		expect(messageDones[0]!.item.content[0].text).toBe("Checking the weather.");
		expect(messageDones[1]!.output_index).toBe(2);
		expect(messageDones[1]!.item.phase).toBe("final_answer");
		expect(messageDones[1]!.item.content[0].text).toBe("It is sunny.");
		expect(messageDones[0]!.item.id).not.toBe(messageDones[1]!.item.id);

		// Final output keeps both items in stream order.
		const finalOutput = buildFinalOutputItems(state);
		expect(finalOutput.map((o) => ({ type: o.type, phase: o.phase }))).toEqual([
			{ type: "message", phase: "commentary" },
			{ type: "function_call", phase: undefined },
			{ type: "message", phase: "final_answer" },
		]);
	});

	it("keeps same-phase messages split by a tool call as separate streamed items", () => {
		const state = createStreamingState("gpt-5.6");
		const events: Array<{ event: string; data: string }> = [];

		// Simulates the translator's chunks for:
		// commentary A -> function_call 1 -> commentary B -> function_call 2
		events.push(
			...processStreamChunk(
				{
					choices: [
						{
							delta: {
								role: "assistant",
								message_start: true,
								phase: "commentary",
							},
						},
					],
				},
				state,
			),
			...processStreamChunk(
				{ choices: [{ delta: { content: "Commentary A" } }] },
				state,
			),
			...processStreamChunk(
				{
					choices: [
						{
							delta: {
								tool_calls: [
									{
										index: 0,
										id: "call_1",
										function: { name: "tool_one", arguments: "{}" },
									},
								],
							},
						},
					],
				},
				state,
			),
			...processStreamChunk(
				{
					choices: [
						{
							delta: {
								role: "assistant",
								message_start: true,
								phase: "commentary",
							},
						},
					],
				},
				state,
			),
			...processStreamChunk(
				{ choices: [{ delta: { content: "Commentary B" } }] },
				state,
			),
			...processStreamChunk(
				{
					choices: [
						{
							delta: {
								tool_calls: [
									{
										index: 1,
										id: "call_2",
										function: { name: "tool_two", arguments: "{}" },
									},
								],
							},
						},
					],
				},
				state,
			),
			...processStreamChunk(
				{ choices: [{ delta: {}, finish_reason: "tool_calls" }] },
				state,
			),
		);

		const added = events
			.filter((e) => e.event === "response.output_item.added")
			.map((e) => JSON.parse(e.data))
			.map((d) => ({ type: d.item.type, index: d.output_index }));
		expect(added).toEqual([
			{ type: "message", index: 0 },
			{ type: "function_call", index: 1 },
			{ type: "message", index: 2 },
			{ type: "function_call", index: 3 },
		]);

		const finalOutput = buildFinalOutputItems(state);
		expect(
			finalOutput.map((o) =>
				o.type === "function_call"
					? (o.name as string)
					: (o.content as Array<{ text: string }>)[0]!.text,
			),
		).toEqual(["Commentary A", "tool_one", "Commentary B", "tool_two"]);
		expect(finalOutput[0]!.phase).toBe("commentary");
		expect(finalOutput[2]!.phase).toBe("commentary");
	});

	it("reports the effective reasoning.context from the terminal chunk in streaming", () => {
		const state = createStreamingState("gpt-5.6", undefined, {
			reasoning: { effort: "high", context: "auto" },
		});
		processStreamChunk({ choices: [{ delta: { content: "Hi" } }] }, state);
		processStreamChunk(
			{
				choices: [{ delta: {}, finish_reason: "stop" }],
				reasoning_context: "current_turn",
			},
			state,
		);

		const events = createCompletionEvents(state);
		const completedData = JSON.parse(
			events.find((e) => e.event === "response.completed")!.data,
		);
		expect(completedData.response.reasoning.context).toBe("current_turn");
	});

	it("echoes the assistant-message phase on streamed message items", () => {
		const state = createStreamingState("gpt-5.6");
		processStreamChunk(
			{ choices: [{ delta: { role: "assistant", phase: "final_answer" } }] },
			state,
		);
		processStreamChunk({ choices: [{ delta: { content: "Hello" } }] }, state);
		processStreamChunk(
			{ choices: [{ delta: {}, finish_reason: "stop" }] },
			state,
		);

		const events = createCompletionEvents(state);
		const messageDone = events.find(
			(e) =>
				e.event === "response.output_item.done" &&
				JSON.parse(e.data).item.type === "message",
		);
		expect(messageDone).toBeDefined();
		expect(JSON.parse(messageDone!.data).item.phase).toBe("final_answer");
		const completedData = JSON.parse(
			events.find((e) => e.event === "response.completed")!.data,
		);
		const messageOutput = completedData.response.output.find(
			(o: { type: string }) => o.type === "message",
		);
		expect(messageOutput.phase).toBe("final_answer");
	});

	it("captures encrypted reasoning deltas and gates them on the include opt-in", () => {
		const state = createStreamingState("gpt-5.5");
		// Summary text streams first, then the encrypted payload arrives when the
		// provider's reasoning item completes.
		processStreamChunk(
			{ choices: [{ delta: { reasoning: "thinking..." } }] },
			state,
		);
		processStreamChunk(
			{
				choices: [
					{
						delta: {
							reasoning_details: [
								{
									type: "reasoning.encrypted",
									data: "gAAAA-encrypted-blob",
									id: "rs_upstream",
									format: "openai-responses-v1",
								},
							],
						},
					},
				],
			},
			state,
		);
		processStreamChunk({ choices: [{ delta: { content: "Hello" } }] }, state);

		// Without the include opt-in, no encrypted_content on the wire.
		// (createCompletionEvents only advances sequence numbers, so the same
		// state can be replayed with the opt-in below.)
		const strippedEvents = createCompletionEvents(state, false);
		const strippedCompleted = JSON.parse(
			strippedEvents.find((e) => e.event === "response.completed")!.data,
		);
		const strippedReasoning = strippedCompleted.response.output.find(
			(o: Record<string, unknown>) => o.type === "reasoning",
		);
		expect(strippedReasoning).toBeDefined();
		expect(strippedReasoning.encrypted_content).toBeUndefined();

		// With include:["reasoning.encrypted_content"], the payload is returned.
		const events = createCompletionEvents(state, true);
		const reasoningDone = events.find(
			(e) =>
				e.event === "response.output_item.done" &&
				JSON.parse(e.data).item.type === "reasoning",
		);
		expect(reasoningDone).toBeDefined();
		const reasoningItem = JSON.parse(reasoningDone!.data).item;
		expect(reasoningItem.encrypted_content).toBe("gAAAA-encrypted-blob");
		expect(reasoningItem.id).toBe("rs_upstream");
		expect(reasoningItem.summary[0].text).toBe("thinking...");

		const completed = JSON.parse(
			events.find((e) => e.event === "response.completed")!.data,
		);
		const outReasoning = completed.response.output.find(
			(o: Record<string, unknown>) => o.type === "reasoning",
		);
		expect(outReasoning.encrypted_content).toBe("gAAAA-encrypted-blob");

		// Storage always keeps the encrypted payload for chaining.
		const stored = buildFinalOutputItems(state);
		const storedReasoning = stored.find((o) => o.type === "reasoning");
		expect(storedReasoning!.encrypted_content).toBe("gAAAA-encrypted-blob");
	});

	it("keeps added/done lifecycles consistent per encrypted reasoning item", () => {
		const state = createStreamingState("gpt-5.5");
		// Summary text first: added is deferred until the upstream id arrives.
		const summaryEvents = processStreamChunk(
			{ choices: [{ delta: { reasoning: "thinking..." } }] },
			state,
		);
		expect(
			summaryEvents.some((e) => e.event === "response.output_item.added"),
		).toBe(false);

		// Two encrypted reasoning items arrive, each with its own upstream id.
		const addedEvents = [
			...processStreamChunk(
				{
					choices: [
						{
							delta: {
								reasoning_details: [
									{
										type: "reasoning.encrypted",
										data: "blob-1",
										id: "rs_up1",
										format: "openai-responses-v1",
									},
									{
										type: "reasoning.encrypted",
										data: "blob-2",
										id: "rs_up2",
										format: "openai-responses-v1",
									},
									// Foreign formats must not become encrypted_content items.
									{
										type: "reasoning.encrypted",
										data: "foreign-blob",
										id: "rs_foreign",
										format: "anthropic-claude-v1",
									},
								],
							},
						},
					],
				},
				state,
			),
			...processStreamChunk(
				{ choices: [{ delta: { content: "Hello" } }] },
				state,
			),
		]
			.filter((e) => e.event === "response.output_item.added")
			.map((e) => JSON.parse(e.data));

		const doneEvents = createCompletionEvents(state, true)
			.filter((e) => e.event === "response.output_item.done")
			.map((e) => JSON.parse(e.data));

		const addedReasoning = addedEvents.filter(
			(e) => e.item.type === "reasoning",
		);
		const doneReasoning = doneEvents.filter((e) => e.item.type === "reasoning");

		// One added and one done per item, agreeing on id and output_index.
		expect(
			addedReasoning.map((e) => ({ id: e.item.id, index: e.output_index })),
		).toEqual([
			{ id: "rs_up1", index: 0 },
			{ id: "rs_up2", index: 1 },
		]);
		expect(
			doneReasoning.map((e) => ({ id: e.item.id, index: e.output_index })),
		).toEqual([
			{ id: "rs_up1", index: 0 },
			{ id: "rs_up2", index: 1 },
		]);
		expect(doneReasoning[0]!.item.encrypted_content).toBe("blob-1");
		expect(doneReasoning[1]!.item.encrypted_content).toBe("blob-2");
		// Summary text rides on the first item only.
		expect(doneReasoning[0]!.item.summary[0].text).toBe("thinking...");
		expect(doneReasoning[1]!.item.summary).toEqual([]);

		// The message item follows the reasoning items in both event streams
		// and the terminal output array.
		const addedMessage = addedEvents.find((e) => e.item.type === "message");
		const doneMessage = doneEvents.find((e) => e.item.type === "message");
		expect(addedMessage!.output_index).toBe(2);
		expect(doneMessage!.output_index).toBe(2);
		const stored = buildFinalOutputItems(state);
		expect(stored.map((o) => o.type)).toEqual([
			"reasoning",
			"reasoning",
			"message",
		]);
	});

	it("starts the reasoning item from an encrypted-only delta (no summary text)", () => {
		const state = createStreamingState("gpt-5.5");
		const events = processStreamChunk(
			{
				choices: [
					{
						delta: {
							reasoning_details: [
								{
									type: "reasoning.encrypted",
									data: "gAAAA-blob",
									id: "rs_upstream",
									format: "openai-responses-v1",
								},
							],
						},
					},
				],
			},
			state,
		);

		const added = events.find((e) => e.event === "response.output_item.added");
		expect(added).toBeDefined();
		const item = JSON.parse(added!.data).item;
		expect(item.type).toBe("reasoning");
		expect(item.id).toBe("rs_upstream");
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
