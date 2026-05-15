import { describe, it, expect } from "vitest";
import { z } from "zod";

import { responsesRequestSchema } from "./schemas.js";
import { convertChatResponseToResponses } from "./tools/convert-chat-to-responses.js";
import {
	createCompletionEvents,
	createResponseCreatedEvent,
	createStreamingState,
	processStreamChunk,
} from "./tools/convert-streaming-to-responses.js";

/**
 * Vendored subset of the Open Responses spec's `ResponseResource` schema.
 * Mirrors the required-fields list at
 * https://github.com/openresponses/openresponses (public/openapi/openapi.json
 * lines 2424-2717). A response that conforms to this schema also conforms to
 * the spec's ResponseResource (modulo extension fields, which the spec allows).
 *
 * Output items only validate the basic discriminator + the fields the
 * compliance suite asserts on (message.role, function_call.call_id, etc.).
 */
const usageSchema = z
	.object({
		input_tokens: z.number(),
		output_tokens: z.number(),
		total_tokens: z.number(),
		input_tokens_details: z.object({
			cached_tokens: z.number(),
		}),
		output_tokens_details: z.object({
			reasoning_tokens: z.number(),
		}),
	})
	.passthrough();

const outputTextContentSchema = z
	.object({
		type: z.literal("output_text"),
		text: z.string(),
		annotations: z.array(z.unknown()),
	})
	.passthrough();

const messageContentPartSchema = z.union([
	outputTextContentSchema,
	z
		.object({ type: z.string() })
		.passthrough()
		.refine((v) => v.type !== "output_text", {
			message: "output_text content parts must match outputTextContentSchema",
		}),
]);

const messageOutputItemSchema = z
	.object({
		type: z.literal("message"),
		id: z.string(),
		status: z.string(),
		role: z.enum(["assistant", "user", "system", "developer"]),
		content: z.array(messageContentPartSchema),
		phase: z.enum(["commentary", "final_answer"]).optional(),
	})
	.passthrough();

const functionCallOutputItemSchema = z
	.object({
		type: z.literal("function_call"),
		id: z.string(),
		call_id: z.string(),
		name: z.string(),
		arguments: z.string(),
		status: z.enum(["in_progress", "completed", "incomplete"]),
	})
	.passthrough();

const reasoningOutputItemSchema = z
	.object({
		type: z.literal("reasoning"),
		id: z.string(),
	})
	.passthrough();

const outputItemSchema = z.union([
	messageOutputItemSchema,
	functionCallOutputItemSchema,
	reasoningOutputItemSchema,
	z.object({ type: z.string() }).passthrough(),
]);

const functionToolSchema = z
	.object({
		type: z.literal("function"),
		name: z.string(),
		description: z.union([z.string(), z.null()]),
		parameters: z.union([z.record(z.any()), z.null()]),
		strict: z.union([z.boolean(), z.null()]),
	})
	.passthrough();

const echoedToolSchema = z.union([
	functionToolSchema,
	z
		.object({ type: z.string() })
		.passthrough()
		.refine((v) => v.type !== "function", {
			message: "function tools must match functionToolSchema",
		}),
]);

export const responseResourceSchema = z
	.object({
		id: z.string(),
		object: z.literal("response"),
		created_at: z.number(),
		completed_at: z.number().nullable(),
		status: z.string(),
		incomplete_details: z
			.object({ reason: z.string() })
			.passthrough()
			.nullable(),
		model: z.string(),
		previous_response_id: z.string().nullable(),
		instructions: z.string().nullable(),
		output: z.array(outputItemSchema),
		error: z
			.object({ code: z.string(), message: z.string() })
			.passthrough()
			.nullable(),
		tools: z.array(echoedToolSchema),
		tool_choice: z.unknown(),
		truncation: z.enum(["auto", "disabled"]),
		parallel_tool_calls: z.boolean(),
		text: z
			.object({
				format: z.object({ type: z.string() }).passthrough(),
			})
			.passthrough(),
		top_p: z.number(),
		presence_penalty: z.number(),
		frequency_penalty: z.number(),
		top_logprobs: z.number(),
		temperature: z.number(),
		reasoning: z
			.object({
				effort: z.string().nullable(),
				summary: z.string().nullable(),
			})
			.passthrough()
			.nullable(),
		usage: usageSchema.nullable(),
		max_output_tokens: z.number().nullable(),
		max_tool_calls: z.number().nullable(),
		store: z.boolean(),
		background: z.boolean(),
		service_tier: z.string(),
		metadata: z.record(z.unknown()),
		safety_identifier: z.string().nullable(),
		prompt_cache_key: z.string().nullable(),
	})
	.passthrough();

function expectValid(data: unknown, label: string) {
	const result = responseResourceSchema.safeParse(data);
	if (!result.success) {
		const issues = result.error.issues
			.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
			.join("\n");
		throw new Error(`${label} failed Open Responses schema:\n${issues}`);
	}
	expect(result.success).toBe(true);
}

describe("Open Responses compliance: non-streaming response shape", () => {
	const baseChat = {
		id: "chatcmpl-1",
		object: "chat.completion" as const,
		created: 1_700_000_000,
		model: "gpt-4o-mini",
		choices: [
			{
				index: 0,
				message: { role: "assistant", content: "Hello!" },
				finish_reason: "stop",
			},
		],
		usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
	};

	it("emits all required ResponseResource fields with no echo request", () => {
		const out = convertChatResponseToResponses(baseChat, "gpt-4o-mini");
		expectValid(out, "basic response");
	});

	it("echoes request fields (tools, tool_choice, instructions, temperature, etc.)", () => {
		const out = convertChatResponseToResponses(
			baseChat,
			"gpt-4o-mini",
			"resp_test_123",
			{
				instructions: "You are helpful",
				tools: [{ type: "function", name: "get_weather" }],
				tool_choice: "auto",
				temperature: 0.7,
				top_p: 0.9,
				max_output_tokens: 100,
				metadata: { trace: "abc" },
				prompt_cache_key: "user-123",
				previous_response_id: "resp_prev",
			},
		);
		expectValid(out, "echo response");
		expect(out.id).toBe("resp_test_123");
		expect(out.instructions).toBe("You are helpful");
		expect(out.temperature).toBe(0.7);
		expect(out.top_p).toBe(0.9);
		expect(out.max_output_tokens).toBe(100);
		expect(out.previous_response_id).toBe("resp_prev");
		expect(out.prompt_cache_key).toBe("user-123");
		expect(out.metadata).toMatchObject({ trace: "abc" });
		expect(out.tools).toHaveLength(1);
	});

	it("fills function tool description/parameters/strict with null when omitted (Open Responses tool-calling test)", () => {
		const out = convertChatResponseToResponses(
			baseChat,
			"anthropic/claude-sonnet-4-6",
			undefined,
			{
				tools: [
					{
						type: "function",
						name: "get_weather",
						description: "Get the current weather for a location",
						parameters: {
							type: "object",
							properties: {
								location: { type: "string" },
							},
							required: ["location"],
						},
					},
				],
			},
		);
		expectValid(out, "tool-calling echo response");
		const tool = out.tools[0] as Record<string, unknown>;
		expect(tool.type).toBe("function");
		expect(tool.name).toBe("get_weather");
		expect(tool.description).toBe("Get the current weather for a location");
		expect(tool.parameters).toMatchObject({ type: "object" });
		expect(tool.strict).toBeNull();
	});

	it("usage always includes input_tokens_details and output_tokens_details", () => {
		const out = convertChatResponseToResponses(baseChat, "gpt-4o-mini");
		expect(out.usage?.input_tokens_details.cached_tokens).toBe(0);
		expect(out.usage?.output_tokens_details.reasoning_tokens).toBe(0);
	});

	it("function_call outputs have required call_id, name, arguments, status", () => {
		const chat = {
			...baseChat,
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
									arguments: '{"location":"SF"}',
								},
							},
						],
					},
					finish_reason: "tool_calls",
				},
			],
		};
		const out = convertChatResponseToResponses(chat, "gpt-4o-mini");
		expectValid(out, "function_call response");
		const fc = out.output.find((o) => o.type === "function_call") as
			| Record<string, unknown>
			| undefined;
		expect(fc).toBeDefined();
		expect(fc!.call_id).toBe("call_abc");
		expect(fc!.name).toBe("get_weather");
		expect(fc!.arguments).toBe('{"location":"SF"}');
		expect(fc!.status).toBe("completed");
	});

	it("incomplete status sets completed_at to null and provides incomplete_details", () => {
		const chat = {
			...baseChat,
			choices: [
				{
					message: { role: "assistant", content: "Truncated..." },
					finish_reason: "length",
				},
			],
		};
		const out = convertChatResponseToResponses(chat, "gpt-4o-mini");
		expectValid(out, "incomplete response");
		expect(out.status).toBe("incomplete");
		expect(out.completed_at).toBeNull();
		expect(out.incomplete_details).not.toBeNull();
		expect(out.incomplete_details!.reason).toBe("max_output_tokens");
	});
});

describe("Open Responses compliance: streaming response shape", () => {
	it("response.created payload validates against ResponseResource", () => {
		const state = createStreamingState("gpt-4o-mini", "resp_stream_1", {
			instructions: "be terse",
			temperature: 0.5,
		});
		const event = createResponseCreatedEvent(state);
		const data = JSON.parse(event.data);
		expectValid(data.response, "response.created");
		expect(data.response.status).toBe("in_progress");
	});

	it("response.completed payload validates against ResponseResource", () => {
		const state = createStreamingState("gpt-4o-mini", "resp_stream_2");
		processStreamChunk({ choices: [{ delta: { content: "Hi" } }] }, state);
		processStreamChunk(
			{
				choices: [{ delta: {}, finish_reason: "stop" }],
				usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
			},
			state,
		);
		const events = createCompletionEvents(state);
		const completed = events.find((e) => e.event === "response.completed")!;
		const data = JSON.parse(completed.data);
		expectValid(data.response, "response.completed");
		expect(data.response.status).toBe("completed");
		expect(data.response.completed_at).not.toBeNull();
		expect(data.response.usage.input_tokens_details.cached_tokens).toBe(0);
		expect(data.response.usage.output_tokens_details.reasoning_tokens).toBe(0);
	});

	it("emits sequence_number on every event and annotations on output_text parts (Open Responses Streaming Response test)", () => {
		const state = createStreamingState("gpt-4o-mini", "resp_stream_seq");
		const created = JSON.parse(createResponseCreatedEvent(state).data);
		expect(typeof created.sequence_number).toBe("number");

		const deltaEvents = processStreamChunk(
			{ choices: [{ delta: { content: "Hello" } }] },
			state,
		);
		processStreamChunk(
			{
				choices: [{ delta: {}, finish_reason: "stop" }],
				usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
			},
			state,
		);
		const completionEvents = createCompletionEvents(state);

		const allEvents = [...deltaEvents, ...completionEvents];
		const seqs = allEvents.map(
			(e) => JSON.parse(e.data).sequence_number as unknown,
		);
		for (const s of seqs) {
			expect(typeof s).toBe("number");
		}
		// All sequence numbers (including the response.created at index 0) are unique.
		const all = [created.sequence_number, ...seqs];
		expect(new Set(all).size).toBe(all.length);

		const contentPartAdded = deltaEvents.find(
			(e) => e.event === "response.content_part.added",
		)!;
		expect(
			(JSON.parse(contentPartAdded.data).part as Record<string, unknown>)
				.annotations,
		).toEqual([]);

		const completed = JSON.parse(
			completionEvents.find((e) => e.event === "response.completed")!.data,
		);
		expectValid(completed.response, "response.completed (streaming text)");
		const msg = completed.response.output.find(
			(o: Record<string, unknown>) => o.type === "message",
		);
		expect(msg.content[0].annotations).toEqual([]);
	});

	it("response.created fills function tool strict with null when omitted", () => {
		const state = createStreamingState("gpt-4o-mini", "resp_stream_tools", {
			tools: [{ type: "function", name: "get_weather" }],
		});
		const data = JSON.parse(createResponseCreatedEvent(state).data);
		expectValid(data.response, "response.created (with tool echo)");
		expect(
			(data.response.tools[0] as Record<string, unknown>).strict,
		).toBeNull();
	});

	it("response.completed echoes request fields when streaming state has them", () => {
		const state = createStreamingState("gpt-4o-mini", "resp_stream_3", {
			tools: [{ type: "function", name: "lookup" }],
			tool_choice: "required",
			temperature: 0.3,
			top_p: 0.95,
			parallel_tool_calls: false,
		});
		processStreamChunk({ choices: [{ delta: { content: "ok" } }] }, state);
		const events = createCompletionEvents(state);
		const data = JSON.parse(
			events.find((e) => e.event === "response.completed")!.data,
		);
		expectValid(data.response, "response.completed (with echo)");
		expect(data.response.temperature).toBe(0.3);
		expect(data.response.top_p).toBe(0.95);
		expect(data.response.parallel_tool_calls).toBe(false);
		expect(data.response.tool_choice).toBe("required");
		expect(data.response.tools).toHaveLength(1);
	});

	it("captures reasoning_tokens from upstream completion_tokens_details", () => {
		const state = createStreamingState("gpt-4o-mini");
		processStreamChunk({ choices: [{ delta: { content: "x" } }] }, state);
		processStreamChunk(
			{
				choices: [{ delta: {}, finish_reason: "stop" }],
				usage: {
					prompt_tokens: 1,
					completion_tokens: 10,
					total_tokens: 11,
					completion_tokens_details: { reasoning_tokens: 7 },
				},
			},
			state,
		);
		const events = createCompletionEvents(state);
		const data = JSON.parse(
			events.find((e) => e.event === "response.completed")!.data,
		);
		expect(data.response.usage.output_tokens_details.reasoning_tokens).toBe(7);
	});
});

describe("Open Responses compliance: input request shape", () => {
	it("accepts assistant messages with phase: commentary", () => {
		const result = responsesRequestSchema.safeParse({
			model: "gpt-4o-mini",
			input: [
				{
					type: "message",
					role: "assistant",
					phase: "commentary",
					content: "thinking out loud",
				},
				{
					type: "message",
					role: "assistant",
					phase: "final_answer",
					content: "the answer",
				},
				{ type: "message", role: "user", content: "ok" },
			],
		});
		expect(result.success).toBe(true);
	});

	it("rejects unknown phase values", () => {
		const result = responsesRequestSchema.safeParse({
			model: "gpt-4o-mini",
			input: [
				{
					type: "message",
					role: "assistant",
					phase: "midthought",
					content: "x",
				},
			],
		});
		expect(result.success).toBe(false);
	});

	it("accepts the exact ResponseResource mock fixture from the upstream compliance suite", () => {
		// Mirrors compliance-tests.ts response-output-phase-schema fixture.
		// If our vendored schema starts rejecting this, the schema has drifted
		// from the spec.
		const fixture = {
			id: "resp_phase_schema",
			object: "response",
			created_at: 1_764_967_971,
			completed_at: 1_764_967_972,
			status: "completed",
			incomplete_details: null,
			model: "gpt-4o-mini",
			previous_response_id: null,
			instructions: null,
			output: [
				{
					id: "msg_phase_commentary",
					type: "message",
					status: "completed",
					role: "assistant",
					phase: "commentary",
					content: [
						{
							type: "output_text",
							text: "I am checking the answer.",
							annotations: [],
						},
					],
				},
				{
					id: "msg_phase_final",
					type: "message",
					status: "completed",
					role: "assistant",
					phase: "final_answer",
					content: [
						{
							type: "output_text",
							text: "The answer is four.",
							annotations: [],
						},
					],
				},
			],
			error: null,
			tools: [],
			tool_choice: "auto",
			truncation: "disabled",
			parallel_tool_calls: true,
			text: { format: { type: "text" } },
			top_p: 1,
			presence_penalty: 0,
			frequency_penalty: 0,
			top_logprobs: 0,
			temperature: 1,
			reasoning: { effort: null, summary: null },
			usage: {
				input_tokens: 1,
				output_tokens: 2,
				total_tokens: 3,
				input_tokens_details: { cached_tokens: 0 },
				output_tokens_details: { reasoning_tokens: 0 },
			},
			max_output_tokens: null,
			max_tool_calls: null,
			store: true,
			background: false,
			service_tier: "default",
			metadata: {},
			safety_identifier: null,
			prompt_cache_key: null,
		};
		expectValid(fixture, "upstream mock fixture");
	});
});
