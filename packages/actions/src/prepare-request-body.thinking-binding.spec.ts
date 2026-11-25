import { describe, expect, test } from "vitest";

import {
	DROP_MISMATCHED_THINKING,
	THINKING_BINDING_BETA,
} from "./anthropic-thinking.js";
import { prepareRequestBody } from "./prepare-request-body.js";

import type { BaseMessage, ProviderId } from "@llmgateway/models";

interface Body {
	thinking?: { block_binding?: unknown };
	additionalModelRequestFields?: {
		thinking?: { block_binding?: unknown };
		anthropic_beta?: string[];
	};
}

function conversation(signature?: string): BaseMessage[] {
	return [
		{ role: "user", content: "Hello" },
		{
			role: "assistant",
			content: "Hi",
			...(signature && {
				reasoning_details: [
					{
						type: "reasoning.text",
						text: "Greeting.",
						signature,
						format: "anthropic-claude-v1",
						block_index: 0,
					},
				],
			}),
		},
		{ role: "user", content: "Again" },
	];
}

async function build(
	provider: ProviderId,
	messages: BaseMessage[],
	model = "claude-sonnet-5-5",
): Promise<Body> {
	return (await prepareRequestBody(
		provider,
		model,
		null,
		model,
		messages,
		false,
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
		"high",
		true,
	)) as Body;
}

describe("prepareRequestBody - thinking block binding", () => {
	test("drops mismatched thinking when Anthropic thinking is replayed", async () => {
		const body = await build("anthropic", conversation("anthropic:sig"));
		expect(body.thinking?.block_binding).toEqual(DROP_MISMATCHED_THINKING);
	});

	test("leaves the binding off without replayed thinking", async () => {
		const body = await build("anthropic", conversation());
		expect(body.thinking).toBeDefined();
		expect(body.thinking?.block_binding).toBeUndefined();
	});

	test("leaves Vertex without the binding", async () => {
		const body = await build(
			"vertex-anthropic",
			conversation("vertex-anthropic:sig"),
			"claude-sonnet-4-5",
		);
		expect(body.thinking).toBeDefined();
		expect(body.thinking?.block_binding).toBeUndefined();
	});

	test("drops mismatched thinking on Bedrock's Messages API", async () => {
		const body = await build("aws-bedrock", conversation("aws-bedrock:sig"));
		expect(body.thinking?.block_binding).toEqual(DROP_MISMATCHED_THINKING);
	});

	test("sets the binding and its beta on Bedrock Converse", async () => {
		const body = await build(
			"aws-bedrock",
			conversation("aws-bedrock:sig"),
			"claude-sonnet-4-5",
		);
		expect(body.additionalModelRequestFields?.thinking?.block_binding).toEqual(
			DROP_MISMATCHED_THINKING,
		);
		expect(body.additionalModelRequestFields?.anthropic_beta).toEqual([
			THINKING_BINDING_BETA,
		]);
	});

	test("leaves Bedrock Converse unchanged without replayed thinking", async () => {
		const body = await build(
			"aws-bedrock",
			conversation("anthropic:sig"),
			"claude-sonnet-4-5",
		);
		expect(body.additionalModelRequestFields?.thinking).toBeDefined();
		expect(
			body.additionalModelRequestFields?.thinking?.block_binding,
		).toBeUndefined();
		expect(body.additionalModelRequestFields?.anthropic_beta).toBeUndefined();
	});
});
