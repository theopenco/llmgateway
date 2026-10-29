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

import { models, type ProviderModelMapping } from "@llmgateway/models";

import { app } from "./app.js";

const providerKeys: Record<string, boolean> = {
	anthropic: !!process.env.LLM_ANTHROPIC_API_KEY,
	"aws-bedrock": !!process.env.LLM_AWS_BEDROCK_API_KEY,
	"vertex-anthropic": !!process.env.LLM_VERTEX_ANTHROPIC_SERVICE_ACCOUNT_JSON,
	"azure-anthropic": !!process.env.LLM_AZURE_ANTHROPIC_API_KEY,
};

const selectedModels = process.env.TEST_MODELS?.split(",");

// Every adaptive Claude model plus one budget-era model, on every provider.
// Adaptive mappings that accept the disable declare `none` in
// `reasoningEfforts`; the others 400 on it and must not receive it.
const mappings = models
	.filter(
		(m) =>
			m.family === "anthropic" &&
			(m.id === "claude-haiku-4-5" ||
				m.providers.some(
					(p) => (p as ProviderModelMapping).reasoningMode === "adaptive",
				)),
	)
	.flatMap((m) =>
		(m.providers as ProviderModelMapping[])
			.filter(
				(p) =>
					p.providerId in providerKeys &&
					(selectedModels !== undefined || p.test !== "skip") &&
					!(p.deactivatedAt && new Date(p.deactivatedAt) < new Date()),
			)
			.map((p) => ({
				model: `${p.providerId}/${m.id}`,
				hasKey: providerKeys[p.providerId],
				canDisable:
					p.reasoningMode !== "adaptive" ||
					(p.reasoningEfforts?.includes("none") ?? false),
			})),
	);

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

	for (const { model, hasKey, canDisable } of mappings) {
		const skip = !hasKey || (selectedModels && !selectedModels.includes(model));
		const expectedThinking = canDisable ? { type: "disabled" } : undefined;

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

					if (canDisable) {
						if (stream) {
							expect(text).not.toContain('"type":"thinking"');
						} else {
							const json = JSON.parse(text) as {
								content: Array<{ type: string }>;
							};
							expect(json.content.some((b) => b.type === "thinking")).toBe(
								false,
							);
						}
					}

					const log = await validateLogByRequestId(requestId);
					expect(upstreamThinking(model, log.upstreamRequest)).toEqual(
						expectedThinking,
					);
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
					choices: Array<{ message: { reasoning?: string | null } }>;
				};
				if (logMode || res.status !== 200) {
					console.log(`${model} (${res.status}):`, JSON.stringify(json));
				}
				expect(res.status).toBe(200);
				if (canDisable) {
					expect(json.choices[0]?.message.reasoning ?? "").toBe("");
				}

				const log = await validateLogByRequestId(requestId);
				expect(upstreamThinking(model, log.upstreamRequest)).toEqual(
					expectedThinking,
				);
			},
		);
	}
});
