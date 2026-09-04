import { beforeAll, describe, expect, test, vi } from "vitest";

import { app } from "@/app.js";
import {
	beforeAllHook,
	generateTestRequestId,
	validateLogByRequestId,
} from "@/chat-helpers.e2e.js";

const model = "zai-org/glm-5.3-flash";
const tool = {
	type: "function",
	function: {
		name: "weather",
		description: "Get weather",
		parameters: {
			type: "object",
			properties: { city: { type: "string" } },
			required: ["city"],
			additionalProperties: false,
		},
	},
};
const cases: { name: string; body: Record<string, unknown> }[] = [
	...["none", "minimal", "low", "medium", "high", "xhigh", "max"].map(
		(effort) => ({
			name: `effort ${effort}`,
			body: { reasoning_effort: effort },
		}),
	),
	{ name: "thinking disabled", body: { thinking: { type: "disabled" } } },
	{
		name: "template disabled",
		body: { chat_template_kwargs: { enable_thinking: false } },
	},
	{ name: "enable_thinking false", body: { enable_thinking: false } },
	{ name: "output limit", body: { max_tokens: 131073 } },
	{
		name: "context limit",
		body: {
			messages: [{ role: "user", content: "hello ".repeat(1048577) }],
			max_tokens: 1,
		},
	},
	{
		name: "developer role",
		body: {
			messages: [
				{ role: "developer", content: "Answer briefly." },
				{ role: "user", content: "What is 2 + 2?" },
			],
		},
	},
	{
		name: "assistant prefill",
		body: {
			messages: [
				{ role: "user", content: "What is 2 + 2?" },
				{ role: "assistant", content: "The answer is" },
			],
		},
	},
];
for (const reasoning of ["low", "none"]) {
	for (const choice of [
		"auto",
		"none",
		"required",
		{ type: "function", function: { name: "weather" } },
	]) {
		cases.push({
			name: `tools ${JSON.stringify(choice)} ${reasoning}`,
			body: {
				reasoning_effort: reasoning,
				tools: [tool],
				tool_choice: choice,
				messages: [{ role: "user", content: "Use weather for Paris." }],
			},
		});
	}
	for (const format of [
		{ type: "json_object" },
		{
			type: "json_schema",
			json_schema: {
				name: "answer",
				strict: true,
				schema: {
					type: "object",
					properties: { result: { type: "number" } },
					required: ["result"],
					additionalProperties: false,
				},
			},
		},
	]) {
		cases.push({
			name: `format ${format.type} ${reasoning}`,
			body: {
				reasoning_effort: reasoning,
				response_format: format,
				messages: [
					{ role: "user", content: "Return JSON with result set to 4." },
				],
			},
		});
	}
}

interface Reply {
	usage?: {
		prompt_tokens: number;
		completion_tokens: number;
		prompt_tokens_details?: { cached_tokens?: number };
		completion_tokens_details?: { reasoning_tokens?: number };
	};
	choices?: {
		message?: {
			content?: string;
			reasoning_content?: string;
			tool_calls?: unknown;
		};
		delta?: { reasoning_content?: string };
	}[];
	error?: unknown;
}

describe.skipIf(process.env.TEST_MODELS !== "novita/glm-5.3-flash")(
	"Novita verification",
	() => {
		beforeAll(beforeAllHook);
		test.each(cases)("$name", async ({ name, body }) => {
			const response = await fetch(
				"https://api.novita.ai/openai/v1/chat/completions",
				{
					method: "POST",
					headers: {
						Authorization: `Bearer ${process.env.LLM_NOVITA_AI_API_KEY}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						model,
						max_tokens: 1024,
						messages: [
							{ role: "user", content: "What is 2/3 + 1/4? Be brief." },
						],
						...body,
					}),
					signal: AbortSignal.timeout(90000),
				},
			);
			const reply = (await response.json()) as Reply;
			const message = reply.choices?.[0]?.message;
			console.log(
				"NOVITA_PROBE",
				JSON.stringify({
					name,
					status: response.status,
					usage: reply.usage,
					reasoning: message?.reasoning_content?.length ?? 0,
					content: message?.content?.slice(0, 250),
					toolCalls: message?.tool_calls,
					error: reply.error,
				}),
			);
			expect([200, 400, 422]).toContain(response.status);
		});

		test.each([
			{ name: "small", stream: false, large: false },
			{ name: "large", stream: true, large: true },
			{ name: "large-cached", stream: false, large: true },
		])("billing $name", async ({ name, stream, large }) => {
			const upstreamReplies: Promise<Reply[]>[] = [];
			const originalFetch = globalThis.fetch;
			const spy = vi
				.spyOn(globalThis, "fetch")
				.mockImplementation(async (...args) => {
					const response = await originalFetch(...args);
					if (String(args[0]).includes("api.novita.ai/")) {
						upstreamReplies.push(
							response
								.clone()
								.text()
								.then((text) =>
									stream
										? text
												.split("\n")
												.filter((line) => line.startsWith("data: {"))
												.map((line) => JSON.parse(line.slice(6)) as Reply)
										: [JSON.parse(text) as Reply],
								),
						);
					}
					return response;
				});
			try {
				const requestId = generateTestRequestId();
				const response = await app.request("/v1/chat/completions", {
					method: "POST",
					headers: {
						Authorization: "Bearer real-token",
						"Content-Type": "application/json",
						"x-no-fallback": "true",
						"x-request-id": requestId,
					},
					body: JSON.stringify({
						model: "novita/glm-5.3-flash",
						stream,
						stream_options: stream ? { include_usage: true } : undefined,
						max_tokens: 1024,
						messages: [
							{
								role: "user",
								content: `${large ? "The sky is blue. ".repeat(3000) : ""}What is 2/3 + 1/4? Be brief. ${requestId}`,
							},
						],
					}),
				});
				await response.text();
				expect(response.status).toBe(200);
				const log = await validateLogByRequestId(requestId);
				const replies = (await Promise.all(upstreamReplies)).flat();
				const usage = replies.reverse().find((reply) => reply.usage)?.usage;
				expect(usage).toBeDefined();
				if (!usage) {
					throw new Error("Missing upstream usage");
				}
				const cached = usage.prompt_tokens_details?.cached_tokens ?? 0;
				const inputCost = (usage.prompt_tokens - cached) * 0.075e-6;
				const cachedCost = cached * 0.015e-6;
				const outputCost = usage.completion_tokens * 0.25e-6;
				const expectedCost = inputCost + cachedCost + outputCost;
				console.log(
					"NOVITA_BILLING",
					JSON.stringify({
						name,
						stream,
						usage,
						logPrompt: log.promptTokens,
						logCompletion: log.completionTokens,
						logCached: log.cachedTokens,
						logReasoning: log.reasoningTokens,
						reasoningCharacters: log.reasoningContent?.length,
						expectedCost,
						logCost: log.cost,
					}),
				);
				expect(Number(log.promptTokens)).toBe(usage.prompt_tokens);
				expect(Number(log.completionTokens)).toBe(usage.completion_tokens);
				expect(log.cost).toBeCloseTo(expectedCost, 9);
			} finally {
				spy.mockRestore();
			}
		});
	},
);
