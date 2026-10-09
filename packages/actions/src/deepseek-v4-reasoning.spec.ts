import { describe, expect, test } from "vitest";

import { prepareRequestBody } from "./prepare-request-body.js";

import type { BaseMessage, ProviderId } from "@llmgateway/models";

const toolTurn: BaseMessage = {
	role: "assistant",
	content: "",
	tool_calls: [
		{
			id: "call_weather",
			type: "function",
			function: { name: "get_weather", arguments: '{"city":"Paris"}' },
		},
	],
};
const messages: BaseMessage[] = [
	{ role: "user", content: "Weather in Paris?" },
	toolTurn,
	{ role: "tool", tool_call_id: "call_weather", content: "sunny" },
];
function chatBody(body: Awaited<ReturnType<typeof prepareRequestBody>>) {
	if (
		body instanceof FormData ||
		!("messages" in body) ||
		!Array.isArray(body.messages)
	) {
		throw new Error("Expected a chat completions body");
	}
	return {
		model: "model" in body ? body.model : undefined,
		messages: body.messages.map((message) => ({
			reasoning: "reasoning" in message ? message.reasoning : undefined,
			reasoning_content:
				"reasoning_content" in message ? message.reasoning_content : undefined,
		})),
	};
}

function prepare(
	provider: ProviderId,
	model: string,
	history = messages,
	stream = false,
) {
	return prepareRequestBody(
		provider,
		model,
		null,
		"vendor/deployment",
		history,
		stream,
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
	);
}

describe("DeepSeek V4 reasoning replay", () => {
	test.each([
		"deepseek-v4-flash",
		"deepseek-v4-pro",
		"deepseek-v4.1-flash",
		"deepseek-v4-flash-vision-exp",
		"deepseek-v4-flash-0731",
	])("recognizes canonical %s with a different upstream id", async (model) => {
		const body = chatBody(await prepare("openai", model));
		expect(body.model).toBe("vendor/deployment");
		expect(body.messages[1].reasoning_content).toBe(" ");
	});

	test.each(["deepseek-v3.2", "gpt-4o-mini", "custom"])(
		"does not add reasoning to unrelated %s",
		async (model) => {
			const body = chatBody(await prepare("openai", model));
			expect(body.messages[1].reasoning_content).toBeUndefined();
		},
	);

	test.each([
		["deepseek", ""],
		["moonshot", " "],
		["novita", " "],
		["custom", " "],
		["deepinfra", " "],
	] satisfies [ProviderId, string][])(
		"uses the tool placeholder for %s",
		async (provider, expected) => {
			const body = chatBody(await prepare(provider, "deepseek-v4-flash"));
			expect(body.messages[1].reasoning_content).toBe(expected);
		},
	);

	test.each([false, true])(
		"preserves supplied reasoning (stream=%s)",
		async (stream) => {
			const history: BaseMessage[] = [
				{ ...toolTurn, reasoning: "caller reasoning" },
				{ ...toolTurn, reasoning: "" },
				{ ...toolTurn, reasoning: "ignored", reasoning_content: "original" },
				{ ...toolTurn, reasoning_content: "" },
				{ ...toolTurn, tool_calls: [] },
				{ role: "assistant", content: "Done" },
			];
			const original = structuredClone(history);
			const body = chatBody(
				await prepare("openai", "deepseek-v4.1-flash", history, stream),
			);
			expect(body.messages.map((message) => message.reasoning_content)).toEqual(
				["caller reasoning", " ", "original", "", undefined, undefined],
			);
			expect(history).toEqual(original);
		},
	);

	describe.each([false, true])("field preservation (stream=%s)", (stream) => {
		test.each([
			["openai", "deepseek-v4.1-flash"],
			["runware", "deepseek-v4-flash"],
			["novita", "deepseek-v4-flash"],
			["deepseek", "deepseek-v4.1-flash"],
			["deepseek", "deepseek-v3.2"],
			["moonshot", "kimi-k2.6"],
		] satisfies [ProviderId, string][])(
			"moves tool reasoning and preserves other %s %s turns",
			async (provider, model) => {
				const history: BaseMessage[] = [
					{ ...toolTurn, reasoning: "call the weather tool" },
					{ role: "assistant", content: "Done", reasoning: "ordinary turn" },
					{ ...toolTurn, tool_calls: [], reasoning: "no tool calls" },
					{ ...toolTurn, reasoning_content: "provider reasoning" },
				];
				const original = structuredClone(history);
				const result = await prepare(provider, model, history, stream);
				const body = chatBody(result);
				expect(body.messages).toEqual([
					{ reasoning: undefined, reasoning_content: "call the weather tool" },
					{ reasoning: "ordinary turn", reasoning_content: undefined },
					{ reasoning: "no tool calls", reasoning_content: undefined },
					{ reasoning: undefined, reasoning_content: "provider reasoning" },
				]);
				expect(result).toMatchObject({
					messages: [
						{ ...toolTurn, reasoning_content: "call the weather tool" },
						...original.slice(1),
					],
				});
				expect(history).toEqual(original);
			},
		);

		test.each([
			["openai", "deepseek-v4.1-flash"],
			["runware", "deepseek-v4-flash"],
			["deepseek", "deepseek-v4.1-flash"],
			["deepseek", "deepseek-v3.2"],
			["moonshot", "kimi-k2.5"],
			["moonshot", "kimi-k2.6"],
		] satisfies [ProviderId, string][])(
			"drops the reasoning alias beside supplied reasoning_content on %s %s",
			async (provider, model) => {
				// Runware rejects a message carrying both aliases.
				const history: BaseMessage[] = [
					{
						...toolTurn,
						reasoning: "alias",
						reasoning_content: "provider reasoning",
					},
					{ ...toolTurn, reasoning: "alias", reasoning_content: "" },
					{
						role: "assistant",
						content: "Done",
						reasoning: "alias",
						reasoning_content: "plain turn",
					},
					{ ...toolTurn, reasoning: "", reasoning_content: "empty alias" },
					{
						role: "assistant",
						content: "Done",
						reasoning: "alias",
						reasoning_content: "",
					},
					{
						...toolTurn,
						tool_calls: [],
						reasoning: "alias",
						reasoning_content: "empty tool list",
					},
					{
						role: "user",
						content: "Continue",
						reasoning: "user alias",
						reasoning_content: "user reasoning",
					},
					{
						role: "tool",
						tool_call_id: "call_weather",
						content: "sunny",
						reasoning: "tool alias",
						reasoning_content: "tool reasoning",
					},
				];
				const original = structuredClone(history);
				history.forEach(Object.freeze);
				Object.freeze(history);
				const body = await prepare(provider, model, history, stream);
				expect(body).toMatchObject({
					messages: [
						{ ...toolTurn, reasoning_content: "provider reasoning" },
						{ ...toolTurn, reasoning_content: "" },
						{
							role: "assistant",
							content: "Done",
							reasoning_content: "plain turn",
						},
						{ ...toolTurn, reasoning_content: "empty alias" },
						{ role: "assistant", content: "Done", reasoning_content: "" },
						{
							...toolTurn,
							tool_calls: [],
							reasoning_content: "empty tool list",
						},
						...original.slice(6),
					],
				});
				expect(chatBody(body).messages.map((m) => m.reasoning)).toEqual([
					undefined,
					undefined,
					undefined,
					undefined,
					undefined,
					undefined,
					"user alias",
					"tool alias",
				]);
				expect(history).toEqual(original);
			},
		);

		test.each(["gpt-4o-mini", "deepseek-v3.2"])(
			"preserves echoed reasoning on an unrelated carrier model %s",
			async (model) => {
				const history: BaseMessage[] = [
					{ ...toolTurn, reasoning: "tool reasoning" },
					{ role: "assistant", content: "Done", reasoning: "ordinary turn" },
					{
						role: "assistant",
						content: "Both",
						reasoning: "alias",
						reasoning_content: "kept",
					},
				];
				expect(await prepare("openai", model, history, stream)).toMatchObject({
					messages: history,
				});
			},
		);
	});

	test.each([
		"anthropic",
		"vertex-anthropic",
		"azure-anthropic",
		"aws-bedrock",
		"google-ai-studio",
		"google-vertex",
		"mistral",
	] satisfies ProviderId[])(
		"strips chat reasoning on the %s wire",
		async (provider) => {
			const body = await prepare(provider, "deepseek-v4.1-flash", [
				messages[0],
				{
					...toolTurn,
					reasoning: "caller reasoning",
					reasoning_content: "provider reasoning",
				},
				messages[2],
				{
					role: "assistant",
					content: "Done",
					reasoning: "plain alias",
					reasoning_content: "plain reasoning",
				},
			]);
			expect(JSON.stringify(body)).not.toContain('"reasoning_content"');
			expect(JSON.stringify(body)).not.toContain('"reasoning"');
			expect(JSON.stringify(body)).toContain("get_weather");
		},
	);

	test("strips Fireworks reasoning while retaining supplied provider reasoning", async () => {
		const body = chatBody(
			await prepare("fireworks", "deepseek-v4.1-flash", [
				messages[0],
				{
					...toolTurn,
					reasoning: "caller reasoning",
					reasoning_content: "provider reasoning",
				},
				messages[2],
			]),
		);
		expect(body.messages[1].reasoning).toBeUndefined();
		expect(body.messages[1].reasoning_content).toBe("provider reasoning");
	});

	test("does not leak chat reasoning into Responses input items", async () => {
		const args: Parameters<typeof prepareRequestBody> = [
			"openai",
			"deepseek-v4.1-flash",
			null,
			"vendor/deployment",
			messages,
			false,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
		];
		args[25] = true;
		const body = await prepareRequestBody(...args);
		expect(JSON.stringify(body)).not.toContain('"reasoning_content"');
		expect(JSON.stringify(body)).toContain('"function_call"');
		expect(JSON.stringify(body)).toContain('"function_call_output"');
	});

	test.each([undefined, "", "provider reasoning"])(
		"preserves opaque Responses reasoning and context with reasoning_content=%s",
		async (reasoningContent) => {
			const history: BaseMessage[] = [
				messages[0],
				{
					...toolTurn,
					reasoning: "caller reasoning",
					...(reasoningContent !== undefined && {
						reasoning_content: reasoningContent,
					}),
					reasoning_details: [
						{
							type: "reasoning.encrypted",
							data: "opaque reasoning",
							id: "rs_weather",
							format: "openai-responses-v1",
						},
					],
				},
				messages[2],
			];
			const original = structuredClone(history);
			const args: Parameters<typeof prepareRequestBody> = [
				"openai",
				"deepseek-v4.1-flash",
				null,
				"vendor/deployment",
				history,
				false,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
			];
			args[25] = true;
			args[34] = "all_turns";
			const body = await prepareRequestBody(...args);
			expect(body).toMatchObject({
				reasoning: { context: "all_turns" },
				input: expect.arrayContaining([
					{
						type: "reasoning",
						id: "rs_weather",
						summary: [],
						encrypted_content: "opaque reasoning",
					},
					{
						type: "function_call",
						call_id: "call_weather",
						name: "get_weather",
						arguments: '{"city":"Paris"}',
					},
				]),
			});
			expect(JSON.stringify(body)).not.toContain("caller reasoning");
			expect(history).toEqual(original);
		},
	);
});
