import { describe, expect, test } from "vitest";

import {
	sealAnthropicThinkingBlock,
	toAnthropicReasoningDetail,
	type AnthropicThinkingBlock,
} from "./anthropic-thinking.js";
import { prepareRequestBody } from "./prepare-request-body.js";

import type { BaseMessage, ProviderId } from "@llmgateway/models";

const THINKING: AnthropicThinkingBlock = {
	type: "thinking",
	thinking: "Check the weather tool.",
	signature: "upstream-signature",
};
const REDACTED: AnthropicThinkingBlock = {
	type: "redacted_thinking",
	data: "upstream-redacted-payload",
};

function history(issuer: string): BaseMessage[] {
	return [
		{ role: "user", content: "Weather in Paris?" },
		{
			role: "assistant",
			content: "Checking.",
			tool_calls: [
				{
					id: "toolu_1",
					type: "function",
					function: { name: "get_weather", arguments: '{"city":"Paris"}' },
				},
			],
			reasoning_details: [THINKING, REDACTED].map((block, index) =>
				toAnthropicReasoningDetail(
					sealAnthropicThinkingBlock(issuer, block),
					index,
				),
			),
		},
		{ role: "tool", tool_call_id: "toolu_1", content: "sunny" },
	];
}

async function prepare(provider: ProviderId, messages: BaseMessage[]) {
	const body = await prepareRequestBody(
		provider,
		"claude-sonnet-4-6",
		null,
		"claude-sonnet-4-6",
		messages,
		false,
		undefined,
		1024,
		undefined,
		undefined,
		undefined,
		undefined,
	);
	return body as unknown as {
		messages: Array<{ role: string; content: unknown[] | string }>;
	};
}

function assistantContent(body: Awaited<ReturnType<typeof prepare>>) {
	const content = body.messages.find((m) => m.role === "assistant")!
		.content as Array<Record<string, unknown>>;
	// Bedrock's automatic cache points are not part of the replayed turn.
	return content.filter((block) => !("cachePoint" in block));
}

describe("anthropic thinking replay", () => {
	for (const provider of [
		"anthropic",
		"vertex-anthropic",
		"azure-anthropic",
	] as const) {
		test(`replays ${provider}'s own thinking ahead of the turn's output`, async () => {
			const content = assistantContent(
				await prepare(provider, history(provider)),
			);

			expect(content.slice(0, 2)).toEqual([THINKING, REDACTED]);
			expect(content.slice(2).map((block) => block.type)).toEqual([
				"text",
				"tool_use",
			]);
		});
	}

	test("replays aws-bedrock's own thinking as Converse reasoningContent", async () => {
		const content = assistantContent(
			await prepare("aws-bedrock", history("aws-bedrock")),
		);

		expect(content.slice(0, 2)).toEqual([
			{
				reasoningContent: {
					reasoningText: {
						text: THINKING.thinking,
						signature: "upstream-signature",
					},
				},
			},
			{ reasoningContent: { redactedContent: "upstream-redacted-payload" } },
		]);
		expect(content.slice(2).map((block) => Object.keys(block)[0])).toEqual([
			"text",
			"toolUse",
		]);
	});

	test("replays aws-bedrock thinking on a text-only turn", async () => {
		const [user, assistant] = history("aws-bedrock");
		const content = assistantContent(
			await prepare("aws-bedrock", [
				user!,
				{ ...assistant!, tool_calls: undefined },
				{ role: "user", content: "Thanks." },
			]),
		);

		expect(content.map((block) => Object.keys(block)[0])).toEqual([
			"reasoningContent",
			"reasoningContent",
			"text",
		]);
	});

	test("drops thinking another provider issued", async () => {
		expect(
			assistantContent(await prepare("anthropic", history("aws-bedrock"))).map(
				(block) => block.type,
			),
		).toEqual(["text", "tool_use"]);
		expect(
			assistantContent(await prepare("aws-bedrock", history("anthropic"))).map(
				(block) => Object.keys(block)[0],
			),
		).toEqual(["text", "toolUse"]);
	});

	test("drops a turn's thinking when it did not open the turn", async () => {
		const [user, assistant, tool] = history("anthropic");
		const interleaved = {
			...assistant!,
			reasoning_details: assistant!.reasoning_details!.map((detail, index) => ({
				...detail,
				block_index: index * 2,
			})),
		};

		expect(
			assistantContent(
				await prepare("anthropic", [user!, interleaved, tool!]),
			).map((block) => block.type),
		).toEqual(["text", "tool_use"]);
	});

	test("drops an aws-bedrock turn left with only its thinking", async () => {
		const [user, assistant] = history("aws-bedrock");
		const body = await prepare("aws-bedrock", [
			user!,
			{ ...assistant!, content: "", tool_calls: undefined },
			{ role: "user", content: "Thanks." },
		]);

		expect(body.messages.map((message) => message.role)).not.toContain(
			"assistant",
		);
	});

	test("strips reasoning_details for OpenAI-compatible providers", async () => {
		const body = await prepare("openai", history("anthropic"));

		expect(
			body.messages.some((message) => "reasoning_details" in message),
		).toBe(false);
	});
});
