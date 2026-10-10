import "dotenv/config";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";

import {
	beforeAllHook,
	beforeEachHook,
	generateTestRequestId,
	getTestOptions,
} from "@/chat-helpers.e2e.js";

import { app } from "./app.js";

const mappings = [
	["anthropic/claude-sonnet-5", !!process.env.LLM_ANTHROPIC_API_KEY],
	["anthropic/claude-haiku-4-5", !!process.env.LLM_ANTHROPIC_API_KEY],
	[
		"vertex-anthropic/claude-sonnet-5",
		!!process.env.LLM_VERTEX_ANTHROPIC_SERVICE_ACCOUNT_JSON,
	],
	["aws-bedrock/claude-haiku-4-5", !!process.env.LLM_AWS_BEDROCK_API_KEY],
] as const;

// Keep unrelated TEST_MODELS runs scoped to their selected mappings.
const selectedModels = process.env.TEST_MODELS?.split(",");

describe("tool-result reminders", () => {
	beforeAll(beforeAllHook);
	beforeEach(beforeEachHook);

	for (const [model, hasKey] of mappings) {
		for (const native of [true, false]) {
			for (const stream of [false, true]) {
				for (const placement of ["before", "between", "after"] as const) {
					const endpoint = native ? "/v1/messages" : "/v1/chat/completions";
					test.skipIf(
						!hasKey || (selectedModels && !selectedModels.includes(model)),
					)(
						`${model} ${endpoint} stream=${stream} reminder=${placement}`,
						getTestOptions(),
						async () => {
							const calls = ["one", "two"];
							const messages: unknown[] = [
								{
									role: "user",
									content: `Look up both values and reply with their sum. ${generateTestRequestId()}`,
								},
								native
									? {
											role: "assistant",
											content: calls.map((id) => ({
												type: "tool_use",
												id,
												name: "lookup",
												input: {},
											})),
										}
									: {
											role: "assistant",
											content: "",
											tool_calls: calls.map((id) => ({
												id,
												type: "function",
												function: { name: "lookup", arguments: "{}" },
											})),
										},
								...calls.map((id) =>
									native
										? {
												role: "user",
												content: [
													{
														type: "tool_result",
														tool_use_id: id,
														content: "21",
													},
												],
											}
										: { role: "tool", tool_call_id: id, content: "21" },
								),
							];
							messages.splice(
								placement === "before" ? 2 : placement === "between" ? 3 : 4,
								0,
								{
									role: "system",
									content:
										"Use the supplied results. Reply with only the sum, no more tool calls.",
								},
							);
							const schema = { type: "object", properties: {} };
							const response = await app.request(endpoint, {
								method: "POST",
								headers: {
									"Content-Type": "application/json",
									Authorization: "Bearer real-token",
									"x-no-fallback": "true",
									"x-request-id": generateTestRequestId(),
								},
								body: JSON.stringify({
									model,
									stream,
									max_tokens: 64,
									messages,
									tools: [
										native
											? {
													name: "lookup",
													description: "Look up a value.",
													input_schema: schema,
												}
											: {
													type: "function",
													function: {
														name: "lookup",
														description: "Look up a value.",
														parameters: schema,
													},
												},
									],
								}),
							});
							const body = await response.text();
							expect(response.status, body).toBe(200);
							if (stream) {
								expect(body).not.toContain('"type":"error"');
								expect(body).toContain(
									native ? "event: message_stop" : "data: [DONE]",
								);
								const text = body
									.split("\n")
									.flatMap((line) => {
										if (!line.startsWith("data: ") || line === "data: [DONE]") {
											return [];
										}
										const chunk = JSON.parse(line.slice(6)) as {
											delta?: { text?: string };
											choices?: Array<{ delta?: { content?: string } }>;
										};
										return native
											? (chunk.delta?.text ?? "")
											: (chunk.choices?.[0]?.delta?.content ?? "");
									})
									.join("");
								expect(text).toContain("42");
							} else {
								const json = JSON.parse(body) as {
									content?: Array<{ text?: string }>;
									choices?: Array<{ message: { content: string } }>;
								};
								const text = native
									? json.content?.map((block) => block.text ?? "").join("")
									: json.choices?.[0]?.message.content;
								expect(text).toContain("42");
							}
						},
					);
				}
			}
		}
	}
});
