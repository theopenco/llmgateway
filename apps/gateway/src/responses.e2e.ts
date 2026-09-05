import "dotenv/config";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/app.js";
import {
	beforeAllHook,
	beforeEachHook,
	generateTestRequestId,
	getConcurrentTestOptions,
	getTestOptions,
	logMode,
	reasoningModels,
	testModels,
	toolCallModels,
	validateLogByRequestId,
} from "@/chat-helpers.e2e.js";

import type { ProviderModelMapping } from "@llmgateway/models";

// Pick one model per provider to keep CI cost manageable while still
// validating the Responses API conversion layer across every provider.
function oneModelPerProvider<T extends { model: string }>(list: T[]): T[] {
	const seen = new Set<string>();
	const out: T[] = [];
	for (const item of list) {
		const provider = item.model.split("/")[0];
		if (seen.has(provider)) {
			continue;
		}
		seen.add(provider);
		out.push(item);
	}
	return out;
}

// Models excluded from the tool-call round-trip test because of
// provider/upstream-level behavior unrelated to the Responses API conversion
// layer:
// - bytedance/gpt-oss-120b: the adapter does not emit stable tool_call ids —
//   the id returned in the first turn is not recognized when sent back as
//   tool_call_id, so the second turn fails.
const TOOL_CALL_DENYLIST = new Set<string>(["bytedance/gpt-oss-120b"]);

const responsesTestModels = oneModelPerProvider(testModels);
// Image-generation mappings answer every request with an image (the Responses
// layer emits placeholder output text), so the multi-turn name-recall
// assertion is unsatisfiable for them; they still run the single-turn case.
// Only reachable when TEST_MODELS pins image-only models for a provider.
const responsesMultiTurnModels = responsesTestModels.filter(
	(m) =>
		!m.providers.some((p: ProviderModelMapping) => p.imageGenerations === true),
);
const responsesToolCallModels = oneModelPerProvider(toolCallModels).filter(
	(m) => !TOOL_CALL_DENYLIST.has(m.model),
);

// Encrypted reasoning payloads are only produced by upstreams reached via the
// OpenAI Responses API (store:false + include:["reasoning.encrypted_content"]).
const encryptedReasoningModels = oneModelPerProvider(
	reasoningModels.filter((m) =>
		m.providers.some(
			(p: ProviderModelMapping) =>
				p.reasoning === true &&
				p.supportsResponsesApi === true &&
				(p.providerId === "openai" || p.providerId === "azure"),
		),
	),
);

interface ResponsesOutputItem {
	type: string;
	role?: string;
	content?: { type: string; text?: string }[];
	call_id?: string;
	name?: string;
	arguments?: string;
}

function getOutputText(json: { output?: ResponsesOutputItem[] }): string {
	const items = json.output ?? [];
	const parts: string[] = [];
	for (const item of items) {
		if (item.type === "message" && Array.isArray(item.content)) {
			for (const c of item.content) {
				if (c.type === "output_text" && typeof c.text === "string") {
					parts.push(c.text);
				}
			}
		}
	}
	return parts.join("");
}

function getFunctionCall(json: {
	output?: ResponsesOutputItem[];
}): ResponsesOutputItem | undefined {
	return (json.output ?? []).find((i) => i.type === "function_call");
}

async function postResponses(body: unknown, requestId: string) {
	return await app.request("/v1/responses", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"x-request-id": requestId,
			"x-no-fallback": "true",
			Authorization: `Bearer real-token`,
		},
		body: JSON.stringify(body),
	});
}

describe("e2e", getConcurrentTestOptions(), () => {
	beforeAll(beforeAllHook);

	beforeEach(beforeEachHook);

	test("empty", () => {
		expect(true).toBe(true);
	});

	test.each(responsesTestModels)(
		"responses single-turn $model",
		getTestOptions(),
		async ({ model }) => {
			const requestId = generateTestRequestId();
			const res = await postResponses(
				{
					model,
					input: "Say hello in one short sentence.",
				},
				requestId,
			);

			const json = await res.json();
			if (logMode) {
				console.log(
					"responses single-turn response:",
					JSON.stringify(json, null, 2),
				);
			}

			expect(res.status).toBe(200);
			expect(json).toHaveProperty("id");
			expect(typeof json.id).toBe("string");
			expect(json.id.startsWith("resp_")).toBe(true);
			expect(Array.isArray(json.output)).toBe(true);

			const text = getOutputText(json);
			expect(text.length).toBeGreaterThan(0);

			expect(json).toHaveProperty("usage");
			expect(typeof json.usage.input_tokens).toBe("number");
			expect(typeof json.usage.output_tokens).toBe("number");
			expect(json.usage.input_tokens).toBeGreaterThan(0);
			expect(json.usage.output_tokens).toBeGreaterThan(0);

			await validateLogByRequestId(requestId);
		},
	);

	test.each(responsesMultiTurnModels)(
		"responses multi-turn $model",
		getTestOptions(),
		async ({ model }) => {
			const firstRequestId = generateTestRequestId();
			const firstRes = await postResponses(
				{
					model,
					input:
						"My name is Ada. Please remember it. Reply with a brief acknowledgement.",
				},
				firstRequestId,
			);
			const firstJson = await firstRes.json();
			if (logMode) {
				console.log(
					"responses multi-turn first:",
					JSON.stringify(firstJson, null, 2),
				);
			}
			expect(firstRes.status).toBe(200);
			expect(typeof firstJson.id).toBe("string");

			const secondRequestId = generateTestRequestId();
			const secondRes = await postResponses(
				{
					model,
					input: "What is my name? Reply with just the name.",
					previous_response_id: firstJson.id,
				},
				secondRequestId,
			);
			const secondJson = await secondRes.json();
			if (logMode) {
				console.log(
					"responses multi-turn second:",
					JSON.stringify(secondJson, null, 2),
				);
			}
			expect(secondRes.status).toBe(200);
			const text = getOutputText(secondJson);
			expect(text.toLowerCase()).toContain("ada");
		},
	);

	test.each(encryptedReasoningModels)(
		"responses stateless encrypted reasoning $model",
		getTestOptions(),
		async ({ model }) => {
			// The prompt has to make the model actually think: cheap reasoning
			// models (e.g. gpt-5.6-luna) spend zero reasoning tokens on a trivial
			// "remember my name" turn and then emit no reasoning item at all, so
			// there would be no encrypted payload to round-trip.
			const firstInput = [
				{
					role: "user",
					content:
						"My name is Ada. Please remember it. Also work out 17 * 23 step by step and state the result.",
				},
			];
			const firstRequestId = generateTestRequestId();
			const firstRes = await postResponses(
				{
					model,
					store: false,
					include: ["reasoning.encrypted_content"],
					input: firstInput,
				},
				firstRequestId,
			);
			const firstJson = await firstRes.json();
			if (logMode) {
				console.log(
					"responses encrypted reasoning first:",
					JSON.stringify(firstJson, null, 2),
				);
			}

			expect(firstRes.status).toBe(200);
			const reasoningItem = (firstJson.output ?? []).find(
				(i: ResponsesOutputItem & { encrypted_content?: string }) =>
					i.type === "reasoning",
			);
			expect(reasoningItem).toBeDefined();
			expect(typeof reasoningItem.encrypted_content).toBe("string");
			expect(reasoningItem.encrypted_content.length).toBeGreaterThan(0);

			// Stateless second turn: replay the full first output (including the
			// encrypted reasoning item) plus the new user message.
			const secondRequestId = generateTestRequestId();
			const secondRes = await postResponses(
				{
					model,
					store: false,
					include: ["reasoning.encrypted_content"],
					input: [
						...firstInput,
						...firstJson.output,
						{
							role: "user",
							content: "What is my name? Reply with just the name.",
						},
					],
				},
				secondRequestId,
			);
			const secondJson = await secondRes.json();
			if (logMode) {
				console.log(
					"responses encrypted reasoning second:",
					JSON.stringify(secondJson, null, 2),
				);
			}

			expect(secondRes.status).toBe(200);
			const text = getOutputText(secondJson);
			expect(text.toLowerCase()).toContain("ada");

			// Prove the encrypted reasoning item actually reached the upstream
			// request unchanged (the answer alone could come from the replayed
			// plaintext input).
			const secondLog = await validateLogByRequestId(secondRequestId);
			const upstreamRequest = secondLog.upstreamRequest as {
				input?: Array<{ type?: string; encrypted_content?: string }>;
			} | null;
			const upstreamReasoning = (upstreamRequest?.input ?? []).find(
				(item) => item.type === "reasoning",
			);
			expect(upstreamReasoning).toBeDefined();
			expect(upstreamReasoning!.encrypted_content).toBe(
				reasoningItem.encrypted_content,
			);
		},
	);

	test.each(responsesToolCallModels)(
		"responses tool calls $model",
		getTestOptions(),
		async ({ model }) => {
			const tools = [
				{
					type: "function",
					name: "get_weather",
					description: "Get the current weather for a given city",
					parameters: {
						type: "object",
						properties: {
							city: {
								type: "string",
								description: "The city name to get weather for",
							},
						},
						required: ["city"],
					},
				},
			];

			const firstRequestId = generateTestRequestId();
			const firstRes = await postResponses(
				{
					model,
					input: [
						{
							role: "user",
							content: "What's the weather like in San Francisco?",
						},
					],
					tools,
					tool_choice: "required",
				},
				firstRequestId,
			);
			const firstJson = await firstRes.json();
			if (logMode) {
				console.log(
					"responses tool calls first:",
					JSON.stringify(firstJson, null, 2),
				);
			}

			expect(firstRes.status).toBe(200);
			const fnCall = getFunctionCall(firstJson);
			expect(fnCall).toBeDefined();
			expect(fnCall?.name).toBe("get_weather");
			expect(typeof fnCall?.call_id).toBe("string");
			expect(typeof fnCall?.arguments).toBe("string");
			const parsedArgs = JSON.parse(fnCall?.arguments ?? "{}");
			expect(typeof parsedArgs.city).toBe("string");
			expect(parsedArgs.city.toLowerCase()).toContain("san francisco");

			const secondRequestId = generateTestRequestId();
			const secondRes = await postResponses(
				{
					model,
					previous_response_id: firstJson.id,
					input: [
						{
							type: "function_call_output",
							call_id: fnCall?.call_id,
							output: "72F and sunny",
						},
					],
					tools,
				},
				secondRequestId,
			);
			const secondJson = await secondRes.json();
			if (logMode) {
				console.log(
					"responses tool calls second:",
					JSON.stringify(secondJson, null, 2),
				);
			}

			expect(secondRes.status).toBe(200);
			const finalText = getOutputText(secondJson).toLowerCase();
			expect(finalText.length).toBeGreaterThan(0);
			expect(
				finalText.includes("sunny") ||
					finalText.includes("72") ||
					finalText.includes("weather"),
			).toBe(true);

			// The stored first response is retrievable by id (state lives in the
			// dedicated responses storage, independent of data retention).
			const getRes = await app.request(`/v1/responses/${firstJson.id}`, {
				headers: { Authorization: `Bearer real-token` },
			});
			expect(getRes.status).toBe(200);
			const storedJson = await getRes.json();
			expect(storedJson.id).toBe(firstJson.id);
			const storedFnCall = getFunctionCall(storedJson);
			expect(storedFnCall?.name).toBe("get_weather");
			expect(storedFnCall?.call_id).toBe(fnCall?.call_id);
		},
	);

	// Stateless variant of the tool-call round trip: no previous_response_id —
	// the client replays the full history itself (user message + the returned
	// function_call item + the tool result), exactly how Codex-style clients
	// drive the Responses API. Nothing is stored, so the replayed function_call
	// item must convert back into an assistant tool_calls message ahead of the
	// tool result or strict providers reject the orphaned tool message.
	test.each(responsesToolCallModels)(
		"responses tool calls stateless $model",
		getTestOptions(),
		async ({ model }) => {
			const tools = [
				{
					type: "function",
					name: "get_weather",
					description: "Get the current weather for a given city",
					parameters: {
						type: "object",
						properties: {
							city: {
								type: "string",
								description: "The city name to get weather for",
							},
						},
						required: ["city"],
					},
				},
			];
			const firstInput = [
				{
					role: "user",
					content: "What's the weather like in San Francisco?",
				},
			];

			const firstRequestId = generateTestRequestId();
			const firstRes = await postResponses(
				{
					model,
					store: false,
					input: firstInput,
					tools,
					tool_choice: "required",
				},
				firstRequestId,
			);
			const firstJson = await firstRes.json();
			if (logMode) {
				console.log(
					"responses tool calls stateless first:",
					JSON.stringify(firstJson, null, 2),
				);
			}

			expect(firstRes.status).toBe(200);
			const fnCall = getFunctionCall(firstJson);
			expect(fnCall).toBeDefined();
			expect(fnCall?.name).toBe("get_weather");
			expect(typeof fnCall?.call_id).toBe("string");
			const parsedArgs = JSON.parse(fnCall?.arguments ?? "{}");
			expect(parsedArgs.city.toLowerCase()).toContain("san francisco");

			const secondRequestId = generateTestRequestId();
			const secondRes = await postResponses(
				{
					model,
					store: false,
					input: [
						...firstInput,
						...firstJson.output,
						{
							type: "function_call_output",
							call_id: fnCall?.call_id,
							output: "72F and sunny",
						},
					],
					tools,
				},
				secondRequestId,
			);
			const secondJson = await secondRes.json();
			if (logMode) {
				console.log(
					"responses tool calls stateless second:",
					JSON.stringify(secondJson, null, 2),
				);
			}

			expect(secondRes.status).toBe(200);
			const finalText = getOutputText(secondJson).toLowerCase();
			expect(finalText.length).toBeGreaterThan(0);
			expect(
				finalText.includes("sunny") ||
					finalText.includes("72") ||
					finalText.includes("weather"),
			).toBe(true);
		},
	);
});
