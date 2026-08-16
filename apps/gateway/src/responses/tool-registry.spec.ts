import { describe, it, expect } from "vitest";

import { formatValidationError, responsesRequestSchema } from "./schemas.js";
import { convertChatResponseToResponses } from "./tools/convert-chat-to-responses.js";
import { convertResponsesInputToMessages } from "./tools/convert-responses-to-chat.js";
import {
	buildFinalOutputItems,
	createCompletionEvents,
	createStreamingState,
	processStreamChunk,
} from "./tools/convert-streaming-to-responses.js";
import { extractAdditionalTools } from "./tools/tool-registry.js";

// The tool tree Codex 0.144+ sends as its first input item: a default
// `functions` namespace holding a freeform tool plus a regular one, and a
// second namespace whose members must stay addressable.
const ADDITIONAL_TOOLS_ITEM = {
	type: "additional_tools",
	role: "developer",
	tools: [
		{
			type: "namespace",
			name: "functions",
			description: "",
			tools: [
				{ type: "custom", name: "exec", description: "Run JavaScript" },
				{
					type: "function",
					name: "wait",
					description: "Wait",
					parameters: {
						type: "object",
						properties: { ms: { type: "number" } },
					},
				},
			],
		},
		{
			type: "namespace",
			name: "collaboration",
			tools: [{ type: "function", name: "spawn_agent" }],
		},
	],
};

const CODEX_REQUEST = {
	model: "gpt-4o-mini",
	input: [
		ADDITIONAL_TOOLS_ITEM,
		{ role: "user", content: [{ type: "input_text", text: "Test" }] },
	],
};

describe("additional_tools input item", () => {
	it("accepts the request Codex 0.144+ sends", () => {
		const result = responsesRequestSchema.safeParse(CODEX_REQUEST);
		expect(result.success).toBe(true);
	});

	it("names an unknown item type instead of collapsing to Invalid input", () => {
		const result = responsesRequestSchema.safeParse({
			model: "gpt-4o-mini",
			input: [
				{ role: "user", content: "hi" },
				{ type: "totally_new_item_type", foo: 1 },
			],
		});
		expect(result.success).toBe(false);
		const message = formatValidationError(result.error!);
		expect(message).toContain("input.1.type");
		expect(message).not.toBe("input: Invalid input");
	});

	it("still reports the offending field on a malformed known item", () => {
		const result = responsesRequestSchema.safeParse({
			model: "gpt-4o-mini",
			input: [{ type: "function_call", call_id: "c1", name: "f" }],
		});
		expect(result.success).toBe(false);
		expect(formatValidationError(result.error!)).toContain("input.0.arguments");
	});

	it("flattens the tool tree into function tools and removes the item", () => {
		const parsed = responsesRequestSchema.parse(CODEX_REQUEST);
		const { items, tools, registry } = extractAdditionalTools(
			parsed.input as unknown[],
		);

		expect(items).toHaveLength(1);
		expect(tools.map((t) => t.name)).toEqual([
			"exec",
			"wait",
			"collaboration__spawn_agent",
		]);
		expect(registry.customNames.has("exec")).toBe(true);
		expect(registry.namespaces.get("collaboration__spawn_agent")).toBe(
			"collaboration",
		);

		// A freeform tool has no schema, so it is offered as a function taking the
		// raw payload as a single string argument.
		expect(tools[0]!.parameters).toEqual({
			type: "object",
			properties: {
				input: {
					type: "string",
					description:
						"The raw text payload for this tool. Not JSON — pass the content verbatim.",
				},
			},
			required: ["input"],
			additionalProperties: false,
		});
		expect(tools[1]!.parameters).toEqual({
			type: "object",
			properties: { ms: { type: "number" } },
		});
	});

	it("keeps the newest declaration when a chained turn redeclares tools", () => {
		const { tools } = extractAdditionalTools([
			{
				type: "additional_tools",
				tools: [{ type: "function", name: "wait", description: "old" }],
			},
			{
				type: "additional_tools",
				tools: [{ type: "function", name: "wait", description: "new" }],
			},
		]);
		expect(tools).toHaveLength(1);
		expect(tools[0]!.description).toBe("new");
	});
});

describe("freeform tool call round trip", () => {
	const registry = extractAdditionalTools([ADDITIONAL_TOOLS_ITEM]).registry;

	it("re-emits a custom tool call with its raw payload", () => {
		const result = convertChatResponseToResponses(
			{
				choices: [
					{
						message: {
							role: "assistant",
							content: null,
							tool_calls: [
								{
									id: "call_1",
									type: "function",
									function: {
										name: "exec",
										arguments: JSON.stringify({ input: 'text("hi")' }),
									},
								},
							],
						},
						finish_reason: "tool_calls",
					},
				],
			},
			"gpt-4o-mini",
			"resp_1",
			undefined,
			registry,
		);

		expect(result.output[0]).toMatchObject({
			type: "custom_tool_call",
			call_id: "call_1",
			name: "exec",
			input: 'text("hi")',
		});
		expect(result.output[0]).not.toHaveProperty("namespace");
	});

	it("restores the namespace of a namespaced function call", () => {
		const result = convertChatResponseToResponses(
			{
				choices: [
					{
						message: {
							role: "assistant",
							content: null,
							tool_calls: [
								{
									id: "call_2",
									type: "function",
									function: {
										name: "collaboration__spawn_agent",
										arguments: "{}",
									},
								},
							],
						},
						finish_reason: "tool_calls",
					},
				],
			},
			"gpt-4o-mini",
			"resp_2",
			undefined,
			registry,
		);

		expect(result.output[0]).toMatchObject({
			type: "function_call",
			name: "spawn_agent",
			namespace: "collaboration",
			arguments: "{}",
		});
	});

	it("passes a payload through verbatim when it is not the expected JSON", () => {
		const result = convertChatResponseToResponses(
			{
				choices: [
					{
						message: {
							role: "assistant",
							content: null,
							tool_calls: [
								{
									id: "call_3",
									type: "function",
									function: { name: "exec", arguments: "raw payload" },
								},
							],
						},
						finish_reason: "tool_calls",
					},
				],
			},
			"gpt-4o-mini",
			"resp_3",
			undefined,
			registry,
		);

		expect(result.output[0]).toMatchObject({ input: "raw payload" });
	});

	it("converts replayed custom tool calls and outputs back to chat messages", () => {
		const input = responsesRequestSchema.parse({
			model: "gpt-4o-mini",
			input: [
				{ role: "user", content: "go" },
				{
					type: "custom_tool_call",
					call_id: "call_1",
					name: "exec",
					input: 'text("hi")',
				},
				{
					type: "custom_tool_call_output",
					call_id: "call_1",
					output: "hi",
				},
				{
					type: "function_call",
					call_id: "call_2",
					name: "spawn_agent",
					namespace: "collaboration",
					arguments: "{}",
				},
				{ type: "function_call_output", call_id: "call_2", output: "spawned" },
			],
		}).input;

		const messages = convertResponsesInputToMessages(input);

		expect(messages).toHaveLength(5);
		expect(messages[1]).toMatchObject({
			role: "assistant",
			tool_calls: [
				{
					id: "call_1",
					function: { name: "exec", arguments: '{"input":"text(\\"hi\\")"}' },
				},
			],
		});
		expect(messages[2]).toMatchObject({
			role: "tool",
			tool_call_id: "call_1",
			content: "hi",
		});
		expect(messages[3]!.tool_calls?.[0]!.function.name).toBe(
			"collaboration__spawn_agent",
		);
		expect(messages[4]).toMatchObject({ role: "tool", content: "spawned" });
	});

	it("skips items describing activity the gateway cannot replay", () => {
		const input = responsesRequestSchema.parse({
			model: "gpt-4o-mini",
			input: [
				ADDITIONAL_TOOLS_ITEM,
				{ type: "web_search_call", id: "ws_1", status: "completed" },
				{ role: "user", content: "hi" },
			],
		}).input;

		const messages = convertResponsesInputToMessages(input);
		expect(messages).toEqual([{ role: "user", content: "hi" }]);
	});
});

describe("freeform tool call streaming", () => {
	const registry = extractAdditionalTools([ADDITIONAL_TOOLS_ITEM]).registry;

	function streamExecCall() {
		const state = createStreamingState(
			"gpt-4o-mini",
			"resp_1",
			undefined,
			registry,
		);
		const events = [
			...processStreamChunk(
				{
					choices: [
						{
							index: 0,
							delta: {
								tool_calls: [
									{
										index: 0,
										id: "call_1",
										type: "function",
										function: { name: "exec", arguments: "" },
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
							index: 0,
							delta: {
								tool_calls: [
									{
										index: 0,
										function: { arguments: '{"input":"text(1)"}' },
									},
								],
							},
						},
					],
				},
				state,
			),
		];
		return { state, events: [...events, ...createCompletionEvents(state)] };
	}

	it("announces and closes the item as a custom_tool_call", () => {
		const { events } = streamExecCall();
		const parsed = events.map((e) => JSON.parse(e.data));

		const added = parsed.find((e) => e.type === "response.output_item.added");
		expect(added.item).toMatchObject({
			type: "custom_tool_call",
			name: "exec",
			input: "",
		});

		const done = parsed.find(
			(e) => e.type === "response.output_item.done" && e.item.call_id,
		);
		expect(done.item).toMatchObject({
			type: "custom_tool_call",
			name: "exec",
			input: "text(1)",
		});
	});

	it("emits the payload as custom_tool_call_input events, not argument deltas", () => {
		const { events } = streamExecCall();
		const types = events.map((e) => JSON.parse(e.data).type);

		expect(types).not.toContain("response.function_call_arguments.delta");
		expect(types).toContain("response.custom_tool_call_input.delta");
		expect(types).toContain("response.custom_tool_call_input.done");

		const inputDone = events
			.map((e) => JSON.parse(e.data))
			.find((e) => e.type === "response.custom_tool_call_input.done");
		expect(inputDone.input).toBe("text(1)");
	});

	it("stores the unwrapped payload in the final output", () => {
		const { state } = streamExecCall();
		expect(buildFinalOutputItems(state)[0]).toMatchObject({
			type: "custom_tool_call",
			name: "exec",
			input: "text(1)",
		});
	});
});
