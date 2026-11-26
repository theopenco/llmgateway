import { describe, expect, test } from "vitest";

import { prepareRequestBody } from "./prepare-request-body.js";

import type { BaseMessage } from "@llmgateway/models";

interface Marked {
	cache_control?: { type: string; ttl?: string };
}

interface AnthropicBody {
	system?: Marked[];
	messages?: Array<{ content: Marked[] | string }>;
}

const longText = "Cached context. ".repeat(600);

async function build(messages: BaseMessage[]): Promise<AnthropicBody> {
	return (await prepareRequestBody(
		"anthropic",
		"claude-sonnet-4-6",
		null,
		"claude-sonnet-4-6",
		messages,
		false,
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
	)) as AnthropicBody;
}

function markers(body: AnthropicBody): Array<string | undefined> {
	return [
		...(body.system ?? []),
		...(body.messages ?? []).flatMap((message) =>
			Array.isArray(message.content) ? message.content : [],
		),
	].flatMap((block) =>
		block.cache_control ? [block.cache_control.ttl ?? "5m"] : [],
	);
}

describe("prepareRequestBody - Anthropic cache TTL ordering", () => {
	test("drops a 5m system marker that precedes a 1h message marker", async () => {
		const body = await build([
			{
				role: "system",
				content: [
					{
						type: "text",
						text: longText,
						cache_control: { type: "ephemeral" },
					},
				],
			},
			{
				role: "user",
				content: [
					{ type: "text", text: "Hello" },
					{
						type: "text",
						text: longText,
						cache_control: { type: "ephemeral", ttl: "1h" },
					},
				],
			},
		]);
		expect(markers(body)).toEqual(["1h"]);
	});

	test("drops a 5m marker earlier in the same message", async () => {
		const body = await build([
			{
				role: "user",
				content: [
					{
						type: "text",
						text: longText,
						cache_control: { type: "ephemeral", ttl: "5m" },
					},
					{
						type: "text",
						text: longText,
						cache_control: { type: "ephemeral", ttl: "1h" },
					},
				],
			},
		]);
		expect(markers(body)).toEqual(["1h"]);
	});

	test("keeps 5m markers after the last 1h marker", async () => {
		const body = await build([
			{
				role: "system",
				content: [
					{
						type: "text",
						text: longText,
						cache_control: { type: "ephemeral", ttl: "1h" },
					},
				],
			},
			{
				role: "user",
				content: [
					{
						type: "text",
						text: longText,
						cache_control: { type: "ephemeral" },
					},
				],
			},
		]);
		expect(markers(body)).toEqual(["1h", "5m"]);
	});
});
