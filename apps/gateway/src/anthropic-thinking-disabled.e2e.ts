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

const mappings = [
	["anthropic/claude-haiku-5-5", anthropicKey],
	["anthropic/claude-sonnet-5", anthropicKey],
	["aws-bedrock/claude-haiku-5-5", bedrockKey],
	["aws-bedrock/claude-sonnet-5", bedrockKey],
	["vertex-anthropic/claude-sonnet-5", vertexKey],
	["azure-anthropic/claude-sonnet-5", azureKey],
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

function upstreamThinking(model: string, upstreamRequest: unknown) {
	const body = upstreamRequest as {
		thinking?: unknown;
		additionalModelRequestFields?: { thinking?: unknown };
	};
	return model.startsWith("aws-bedrock/")
		? body.additionalModelRequestFields?.thinking
		: body.thinking;
}

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

// An explicit disable has to reach Claude: without it, adaptive models decide
// for themselves whether to think.
describe("Claude thinking disabled", () => {
	beforeAll(beforeAllHook);
	beforeEach(beforeEachHook);

	for (const [model, hasKey] of mappings) {
		const skip = !hasKey || (selectedModels && !selectedModels.includes(model));

		for (const stream of [false, true]) {
			test.skipIf(skip)(
				`${model} /v1/messages thinking disabled stream=${stream}`,
				getTestOptions(),
				async () => {
					const requestId = generateTestRequestId();
					const res = await post(
						"/v1/messages",
						{
							model,
							max_tokens: 512,
							stream,
							thinking: { type: "disabled" },
							tool_choice: { type: "tool", name: weatherTool.name },
							tools: [
								{
									name: weatherTool.name,
									description: weatherTool.description,
									input_schema: weatherTool.parameters,
								},
							],
							messages: [
								{
									role: "user",
									content: `What is the weather in Tokyo? ${requestId}`,
								},
							],
						},
						requestId,
					);
					const text = await res.text();
					if (logMode || res.status !== 200) {
						console.log(`${model} (${res.status}):`, text);
					}
					expect(res.status).toBe(200);

					if (stream) {
						expect(text).toContain('"type":"tool_use"');
						expect(text).not.toContain('"type":"thinking"');
					} else {
						const json = JSON.parse(text) as {
							content: Array<{ type: string; name?: string }>;
						};
						expect(json.content.some((b) => b.type === "thinking")).toBe(false);
						expect(
							json.content.some(
								(b) => b.type === "tool_use" && b.name === weatherTool.name,
							),
						).toBe(true);
					}

					const log = await validateLogByRequestId(requestId);
					expect(upstreamThinking(model, log.upstreamRequest)).toEqual({
						type: "disabled",
					});
				},
			);
		}

		test.skipIf(skip)(
			`${model} /v1/chat/completions reasoning_effort none`,
			getTestOptions(),
			async () => {
				const requestId = generateTestRequestId();
				const res = await post(
					"/v1/chat/completions",
					{
						model,
						max_tokens: 512,
						reasoning_effort: "none",
						tool_choice: {
							type: "function",
							function: { name: weatherTool.name },
						},
						tools: [{ type: "function", function: weatherTool }],
						messages: [
							{
								role: "user",
								content: `What is the weather in Tokyo? ${requestId}`,
							},
						],
					},
					requestId,
				);
				const json = (await res.json()) as {
					choices: Array<{
						message: {
							reasoning?: string | null;
							tool_calls?: Array<{ function: { name: string } }>;
						};
					}>;
				};
				if (logMode || res.status !== 200) {
					console.log(`${model} (${res.status}):`, JSON.stringify(json));
				}
				expect(res.status).toBe(200);
				const message = json.choices[0]?.message;
				expect(message?.tool_calls?.[0]?.function.name).toBe(weatherTool.name);
				expect(message?.reasoning ?? "").toBe("");

				const log = await validateLogByRequestId(requestId);
				expect(upstreamThinking(model, log.upstreamRequest)).toEqual({
					type: "disabled",
				});
			},
		);
	}
});
