import "dotenv/config";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";

import {
	beforeAllHook,
	beforeEachHook,
	generateTestRequestId,
	getTestOptions,
	logMode,
	validateLogByRequestId,
} from "@/chat-helpers.e2e.js";

import { app } from "./app.js";

const anthropicKey = !!process.env.LLM_ANTHROPIC_API_KEY;
const bedrockKey = !!process.env.LLM_AWS_BEDROCK_API_KEY;
const vertexKey = !!process.env.LLM_VERTEX_ANTHROPIC_SERVICE_ACCOUNT_JSON;
const azureKey = !!process.env.LLM_AZURE_ANTHROPIC_API_KEY;

// [mapping, has key, adaptive thinking]
const mappings = [
	["anthropic/claude-haiku-5-5", anthropicKey, true],
	["anthropic/claude-sonnet-5", anthropicKey, true],
	["aws-bedrock/claude-haiku-5-5", bedrockKey, true],
	["aws-bedrock/claude-sonnet-5", bedrockKey, true],
	["aws-bedrock/claude-haiku-4-5", bedrockKey, false],
	["vertex-anthropic/claude-sonnet-5", vertexKey, true],
	["azure-anthropic/claude-sonnet-5", azureKey, true],
] as const;

const selectedModels = process.env.TEST_MODELS?.split(",");

const weatherTool = {
	name: "get_weather",
	description: "Get the current weather for a city",
	parameters: {
		type: "object",
		properties: { city: { type: "string" } },
		required: ["city"],
	},
};
const timeTool = {
	name: "get_time",
	description: "Get the current time for a city",
	parameters: {
		type: "object",
		properties: { city: { type: "string" } },
		required: ["city"],
	},
};

async function post(path: string, body: unknown, requestId: string) {
	return await app.request(path, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"x-request-id": requestId,
			"x-no-fallback": "true",
			"x-debug": "true",
			Authorization: "Bearer real-token",
		},
		body: JSON.stringify(body),
	});
}

// The prompt never asks for a tool, so a tool call proves the choice was
// enforced upstream rather than chosen by the model.
describe("Claude forced tool choice", () => {
	beforeAll(beforeAllHook);
	beforeEach(beforeEachHook);

	for (const [model, hasKey, adaptive] of mappings) {
		const skip = !hasKey || (selectedModels && !selectedModels.includes(model));
		const efforts = adaptive
			? ([undefined, "none", "high"] as const)
			: ([undefined] as const);

		for (const effort of efforts) {
			for (const choice of ["required", "function"] as const) {
				test.skipIf(skip)(
					`${model} /v1/chat/completions tool_choice=${choice} effort=${effort}`,
					getTestOptions(),
					async () => {
						const requestId = generateTestRequestId();
						const res = await post(
							"/v1/chat/completions",
							{
								model,
								max_tokens: 2048,
								...(effort && { reasoning_effort: effort }),
								tool_choice:
									choice === "required"
										? "required"
										: {
												type: "function",
												function: { name: timeTool.name },
											},
								tools: [
									{ type: "function", function: weatherTool },
									{ type: "function", function: timeTool },
								],
								messages: [
									{
										role: "user",
										content: `Say hi in one word. ${requestId}`,
									},
								],
							},
							requestId,
						);
						const json = (await res.json()) as {
							choices: Array<{
								finish_reason: string;
								message: {
									tool_calls?: Array<{ function: { name: string } }>;
								};
							}>;
						};
						if (logMode || res.status !== 200) {
							console.log(`${model} (${res.status}):`, JSON.stringify(json));
						}
						expect(res.status).toBe(200);
						const toolCalls = json.choices[0]?.message.tool_calls ?? [];
						expect(toolCalls.length).toBeGreaterThan(0);
						if (choice === "function") {
							expect(toolCalls[0]?.function.name).toBe(timeTool.name);
						}

						const log = await validateLogByRequestId(requestId);
						const upstream = log.upstreamRequest as {
							tool_choice?: unknown;
							toolConfig?: { toolChoice?: unknown };
						};
						const expected =
							choice === "required"
								? model.startsWith("aws-bedrock/")
									? { any: {} }
									: { type: "any" }
								: model.startsWith("aws-bedrock/")
									? { tool: { name: timeTool.name } }
									: { type: "tool", name: timeTool.name };
						expect(
							model.startsWith("aws-bedrock/")
								? upstream.toolConfig?.toolChoice
								: upstream.tool_choice,
						).toEqual(expected);
					},
				);
			}
		}

		test.skipIf(skip)(
			`${model} /v1/messages tool_choice=tool`,
			getTestOptions(),
			async () => {
				const requestId = generateTestRequestId();
				const res = await post(
					"/v1/messages",
					{
						model,
						max_tokens: 2048,
						tool_choice: { type: "tool", name: timeTool.name },
						tools: [weatherTool, timeTool].map((tool) => ({
							name: tool.name,
							description: tool.description,
							input_schema: tool.parameters,
						})),
						messages: [
							{ role: "user", content: `Say hi in one word. ${requestId}` },
						],
					},
					requestId,
				);
				const json = (await res.json()) as {
					content: Array<{ type: string; name?: string }>;
				};
				if (logMode || res.status !== 200) {
					console.log(`${model} (${res.status}):`, JSON.stringify(json));
				}
				expect(res.status).toBe(200);
				expect(
					json.content.some(
						(b) => b.type === "tool_use" && b.name === timeTool.name,
					),
				).toBe(true);
			},
		);
	}
});
