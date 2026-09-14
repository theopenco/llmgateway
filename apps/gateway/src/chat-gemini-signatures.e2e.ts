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
	toolCallModels,
	validateLogByRequestId,
} from "@/chat-helpers.e2e.js";
import { readAll } from "@/test-utils/test-helpers.js";

import { redisClient } from "@llmgateway/cache";

import type { ProviderModelMapping } from "@llmgateway/models";

// Gemini 3+ signs text parts as well as function calls. One (cheapest) model
// per Google provider keeps the cost of the round trips manageable.
const geminiSignatureModels = (() => {
	const seen = new Set<string>();
	return toolCallModels
		.filter((m) => {
			const provider = m.providers[0] as ProviderModelMapping | undefined;
			return (
				provider !== undefined &&
				(provider.providerId === "google-ai-studio" ||
					provider.providerId === "google-vertex") &&
				provider.reasoning === true &&
				!provider.imageGenerations &&
				/^gemini-3/.test(m.model.split("/")[1] ?? "")
			);
		})
		.sort(
			(a, b) =>
				Number(
					(a.providers[0] as ProviderModelMapping).inputPrice ?? Infinity,
				) -
				Number((b.providers[0] as ProviderModelMapping).inputPrice ?? Infinity),
		)
		.filter((m) => {
			const providerId = (m.providers[0] as ProviderModelMapping).providerId;
			if (seen.has(providerId)) {
				return false;
			}
			seen.add(providerId);
			return true;
		});
})();

interface GooglePart {
	text?: string;
	thought?: boolean;
	thoughtSignature?: string;
	functionCall?: { name: string };
}

interface ReasoningDetail {
	type?: string;
	format?: string;
	signature?: string;
	google_part?: unknown;
}

const weatherFunction = {
	name: "get_weather",
	description: "Get the current weather for a given city",
	parameters: {
		type: "object",
		properties: {
			city: { type: "string", description: "The city name" },
		},
		required: ["city"],
	},
};

function signedDetails(details: unknown): ReasoningDetail[] {
	return (Array.isArray(details) ? (details as ReasoningDetail[]) : []).filter(
		(detail) =>
			detail.type === "reasoning.text" &&
			detail.format === "google-gemini-v1" &&
			typeof detail.signature === "string" &&
			detail.signature.length > 0,
	);
}

async function post(path: string, body: unknown, requestId: string) {
	return await app.request(path, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"x-request-id": requestId,
			"x-no-fallback": "true",
			"x-debug": "true",
			Authorization: `Bearer real-token`,
		},
		body: JSON.stringify(body),
	});
}

async function readJson(res: Response, label: string) {
	const json = await res.json();
	if (logMode || res.status !== 200) {
		console.log(`${label} (${res.status}):`, JSON.stringify(json, null, 2));
	}
	return json;
}

// The debug log row keeps the Gemini request body, so this proves the
// signatures reached the provider instead of being dropped on replay.
async function expectSignedModelTurn(
	requestId: string,
	matches: (part: GooglePart) => boolean = () => true,
) {
	const log = await validateLogByRequestId(requestId);
	const contents = (
		log.upstreamRequest as {
			contents?: Array<{ role: string; parts: GooglePart[] }>;
		}
	)?.contents;
	expect(Array.isArray(contents)).toBe(true);
	const signedParts = (contents ?? [])
		.filter((content) => content.role === "model")
		.flatMap((content) => content.parts)
		.filter(
			(part) =>
				typeof part.thoughtSignature === "string" &&
				part.thoughtSignature.length > 0 &&
				matches(part),
		);
	expect(signedParts.length).toBeGreaterThan(0);
}

async function forgetCachedSignatures(toolCallIds: string[]) {
	if (toolCallIds.length > 0) {
		await redisClient.del(
			...toolCallIds.map((id) => `thought_signature:${id}`),
		);
	}
}

describe("e2e", getConcurrentTestOptions(), () => {
	beforeAll(beforeAllHook);

	beforeEach(beforeEachHook);

	test("empty", () => {
		expect(true).toBe(true);
	});

	test.each(geminiSignatureModels)(
		"gemini text signatures replay $model",
		getTestOptions(),
		async ({ model }) => {
			const question = {
				role: "user",
				content:
					"Name one prime number between 10 and 20 and say in one sentence why it is prime.",
			};
			const firstRequestId = generateTestRequestId();
			const first = await post(
				"/v1/chat/completions",
				{ model, messages: [question] },
				firstRequestId,
			);
			const firstJson = await readJson(first, "text first");
			expect(first.status).toBe(200);
			const message = firstJson.choices[0].message;
			expect(typeof message.content).toBe("string");
			const details = signedDetails(message.reasoning_details);
			expect(details.length).toBeGreaterThan(0);
			expect(details.every((detail) => detail.google_part)).toBe(true);

			const secondRequestId = generateTestRequestId();
			const second = await post(
				"/v1/chat/completions",
				{
					model,
					messages: [
						question,
						{
							role: "assistant",
							content: message.content,
							reasoning_details: message.reasoning_details,
						},
						{ role: "user", content: "Name a different one." },
					],
				},
				secondRequestId,
			);
			const secondJson = await readJson(second, "text second");
			expect(second.status).toBe(200);
			expect(secondJson.choices[0].message.content).toBeTruthy();
			await expectSignedModelTurn(secondRequestId);
		},
	);

	test.each(geminiSignatureModels)(
		"gemini streamed text signatures replay $model",
		getTestOptions(),
		async ({ model }) => {
			const question = {
				role: "user",
				content:
					"Name one even number between 10 and 20 and say in one sentence why it is even.",
			};
			const firstRequestId = generateTestRequestId();
			const first = await post(
				"/v1/chat/completions",
				{ model, messages: [question], stream: true },
				firstRequestId,
			);
			if (first.status !== 200) {
				console.log("streamed text first:", await first.text());
			}
			expect(first.status).toBe(200);
			const stream = await readAll(first.body);
			expect(stream.hasError).toBe(false);
			const content = stream.chunks
				.map((chunk) => chunk.choices?.[0]?.delta?.content ?? "")
				.join("");
			const reasoningDetails = stream.chunks.flatMap(
				(chunk) => chunk.choices?.[0]?.delta?.reasoning_details ?? [],
			);
			expect(content.length).toBeGreaterThan(0);
			expect(signedDetails(reasoningDetails).length).toBeGreaterThan(0);

			const secondRequestId = generateTestRequestId();
			const second = await post(
				"/v1/chat/completions",
				{
					model,
					messages: [
						question,
						{ role: "assistant", content, reasoning_details: reasoningDetails },
						{ role: "user", content: "Name a different one." },
					],
				},
				secondRequestId,
			);
			const secondJson = await readJson(second, "streamed text second");
			expect(second.status).toBe(200);
			expect(secondJson.choices[0].message.content).toBeTruthy();
			await expectSignedModelTurn(secondRequestId);
		},
	);

	// Gemini 3 rejects a replayed function call without its signature, so a
	// passing second turn proves the client-side replay works once the Redis
	// signature cache is gone.
	test.each(geminiSignatureModels)(
		"gemini tool signatures replay without cache $model",
		getTestOptions(),
		async ({ model }) => {
			const question = {
				role: "user",
				content: "What's the weather like in San Francisco?",
			};
			const tools = [{ type: "function", function: weatherFunction }];
			const firstRequestId = generateTestRequestId();
			const first = await post(
				"/v1/chat/completions",
				{ model, messages: [question], tools, tool_choice: "required" },
				firstRequestId,
			);
			const firstJson = await readJson(first, "tools first");
			expect(first.status).toBe(200);
			const message = firstJson.choices[0].message;
			const toolCalls = message.tool_calls as Array<{
				id: string;
				extra_content?: { google?: { thought_signature?: string } };
			}>;
			expect(toolCalls.length).toBeGreaterThan(0);
			expect(
				toolCalls.every(
					(call) => call.extra_content?.google?.thought_signature,
				),
			).toBe(true);
			await forgetCachedSignatures(toolCalls.map((call) => call.id));

			const secondRequestId = generateTestRequestId();
			const second = await post(
				"/v1/chat/completions",
				{
					model,
					messages: [
						question,
						{
							role: "assistant",
							content: message.content ?? "",
							tool_calls: toolCalls,
							reasoning_details: message.reasoning_details,
						},
						...toolCalls.map((call) => ({
							role: "tool",
							tool_call_id: call.id,
							content: JSON.stringify({ temperature: 72, condition: "Sunny" }),
						})),
					],
					tools,
					tool_choice: "auto",
				},
				secondRequestId,
			);
			const secondJson = await readJson(second, "tools second");
			expect(second.status).toBe(200);
			const reply = secondJson.choices[0].message;
			expect(reply.content ?? reply.tool_calls).toBeTruthy();
			await expectSignedModelTurn(
				secondRequestId,
				(part) => !!part.functionCall,
			);
		},
	);

	test.each(geminiSignatureModels)(
		"responses gemini text signatures replay $model",
		getTestOptions(),
		async ({ model }) => {
			const input = [
				{
					role: "user",
					content:
						"Name one odd number between 10 and 20 and say in one sentence why it is odd.",
				},
			];
			const firstRequestId = generateTestRequestId();
			const first = await post(
				"/v1/responses",
				{ model, store: false, input },
				firstRequestId,
			);
			const firstJson = await readJson(first, "responses text first");
			expect(first.status).toBe(200);
			const messages = (
				firstJson.output as Array<Record<string, unknown>>
			).filter((item) => item.type === "message");
			expect(messages.length).toBeGreaterThan(0);
			expect(
				messages.some(
					(item) => signedDetails(item.reasoning_details).length > 0,
				),
			).toBe(true);

			const secondRequestId = generateTestRequestId();
			const second = await post(
				"/v1/responses",
				{
					model,
					store: false,
					input: [
						...input,
						...firstJson.output,
						{ role: "user", content: "Name a different one." },
					],
				},
				secondRequestId,
			);
			const secondJson = await readJson(second, "responses text second");
			expect(second.status).toBe(200);
			expect(secondJson.output_text ?? secondJson.output).toBeTruthy();
			await expectSignedModelTurn(secondRequestId);
		},
	);

	test.each(geminiSignatureModels)(
		"responses gemini tool signatures replay without cache $model",
		getTestOptions(),
		async ({ model }) => {
			const input = [
				{ role: "user", content: "What's the weather like in Berlin?" },
			];
			const tools = [{ type: "function", ...weatherFunction }];
			const firstRequestId = generateTestRequestId();
			const first = await post(
				"/v1/responses",
				{ model, store: false, input, tools, tool_choice: "required" },
				firstRequestId,
			);
			const firstJson = await readJson(first, "responses tools first");
			expect(first.status).toBe(200);
			const functionCalls = (
				firstJson.output as Array<{
					type: string;
					call_id?: string;
					extra_content?: { google?: { thought_signature?: string } };
				}>
			).filter((item) => item.type === "function_call");
			expect(functionCalls.length).toBeGreaterThan(0);
			expect(
				functionCalls.every(
					(call) => call.extra_content?.google?.thought_signature,
				),
			).toBe(true);
			await forgetCachedSignatures(
				functionCalls.flatMap((call) => (call.call_id ? [call.call_id] : [])),
			);

			const secondRequestId = generateTestRequestId();
			const second = await post(
				"/v1/responses",
				{
					model,
					store: false,
					input: [
						...input,
						...firstJson.output,
						...functionCalls.map((call) => ({
							type: "function_call_output",
							call_id: call.call_id,
							output: "18C and cloudy",
						})),
					],
					tools,
				},
				secondRequestId,
			);
			const secondJson = await readJson(second, "responses tools second");
			expect(second.status).toBe(200);
			expect(secondJson.output.length).toBeGreaterThan(0);
			await expectSignedModelTurn(
				secondRequestId,
				(part) => !!part.functionCall,
			);
		},
	);
});
