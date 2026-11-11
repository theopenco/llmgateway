import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
	createAirsideGatewayFetch,
	prepareProviderModelVerificationRequest,
} from "@llmgateway/actions";
import { redisClient } from "@llmgateway/cache";
import { db, tables } from "@llmgateway/db";
import {
	getApiKeyFingerprint,
	hashApiKeyForStorage,
} from "@llmgateway/shared/api-key-hash";
import { encryptProviderKey } from "@llmgateway/shared/provider-key-crypto";

import { executeAgentRequest } from "../../../packages/benchmarks/src/agent.js";
import { app } from "../src/app.js";
import { waitForPendingWork } from "../src/lib/pending-work.js";
import { createGatewayApiTestHarness } from "../src/test-utils/gateway-api-test-harness.js";

import type { ModelVerificationRequest } from "@llmgateway/actions";
import type { ProviderModelVerificationTarget } from "@llmgateway/db";

const operatorToken = ["operator", "replay", "fixture"].join("-");
const providerToken = ["provider", "replay", "fixture"].join("-");

function google(parts: unknown[], final = false) {
	return {
		candidates: [
			{
				index: 0,
				content: { role: "model", parts },
				...(final ? { finishReason: "STOP" } : {}),
			},
		],
		...(final
			? {
					usageMetadata: {
						promptTokenCount: 10,
						candidatesTokenCount: 5,
						totalTokenCount: 15,
					},
				}
			: {}),
	};
}

function frames(protocol: string, first: boolean): unknown[] {
	if (protocol === "google") {
		return first
			? [
					google([
						{ text: "First", thoughtSignature: "first-text-signature-fixture" },
					]),
					google([
						{
							functionCall: { name: "ping", args: { value: 1 } },
							thoughtSignature: "first-tool-signature-fixture",
						},
					]),
					google([
						{
							text: "Second",
							thoughtSignature: "second-text-signature-fixture",
						},
					]),
					google(
						[
							{
								functionCall: { name: "ping", args: { value: 2 } },
								thoughtSignature: "second-tool-signature-fixture",
							},
						],
						true,
					),
				]
			: [google([{ text: "DONE" }], true)];
	}
	if (protocol === "anthropic") {
		return [
			{
				type: "message_start",
				message: { id: "message-fixture", usage: { input_tokens: 10 } },
			},
			...(first
				? [
						{
							type: "content_block_start",
							index: 0,
							content_block: { type: "thinking", thinking: "" },
						},
						{
							type: "content_block_delta",
							index: 0,
							delta: { type: "thinking_delta", thinking: "thinking fixture" },
						},
						{
							type: "content_block_delta",
							index: 0,
							delta: {
								type: "signature_delta",
								signature: "anthropic-signature-fixture",
							},
						},
						{ type: "content_block_stop", index: 0 },
						{
							type: "content_block_start",
							index: 1,
							content_block: {
								type: "tool_use",
								id: "call-fixture",
								name: "ping",
								input: {},
							},
						},
						{
							type: "content_block_delta",
							index: 1,
							delta: { type: "input_json_delta", partial_json: '{"value":1}' },
						},
						{ type: "content_block_stop", index: 1 },
					]
				: [
						{
							type: "content_block_delta",
							index: 0,
							delta: { type: "text_delta", text: "DONE" },
						},
					]),
			{
				type: "message_delta",
				delta: { stop_reason: first ? "tool_use" : "end_turn" },
				usage: { output_tokens: 5 },
			},
			{ type: "message_stop" },
		];
	}
	return first
		? [
				{
					type: "response.output_text.delta",
					delta: "Checking.",
					output_index: 0,
				},
				{
					type: "response.output_item.done",
					output_index: 0,
					item: {
						type: "reasoning",
						id: "reasoning-fixture",
						encrypted_content: "opaque-reasoning-fixture",
					},
				},
				{
					type: "response.output_item.added",
					output_index: 1,
					item: {
						type: "function_call",
						id: "item-fixture",
						call_id: "call-fixture",
						name: "ping",
						arguments: "",
					},
				},
				{
					type: "response.function_call_arguments.delta",
					output_index: 1,
					delta: '{"value":1}',
				},
				{
					type: "response.output_item.done",
					output_index: 2,
					item: { type: "message", phase: "commentary" },
				},
				{
					type: "response.completed",
					response: {
						status: "completed",
						output: [{ type: "function_call" }],
						usage: { input_tokens: 10, output_tokens: 5 },
					},
				},
			]
		: [
				{ type: "response.output_text.delta", delta: "DONE", output_index: 0 },
				{
					type: "response.completed",
					response: {
						status: "completed",
						usage: { input_tokens: 10, output_tokens: 5 },
					},
				},
			];
}

describe("pinned benchmark multi-turn protocol replay", () => {
	const harness = createGatewayApiTestHarness();
	beforeEach(async () => {
		vi.stubEnv("ALLOW_INSECURE_PROVIDER_URLS", "true");
		vi.stubEnv("AIRSIDE_GATEWAY_API_KEY", operatorToken);
		vi.stubEnv("GATEWAY_URL", "https://gateway.example");
		await harness.setProjectMode("credits");
		await db.insert(tables.apiKey).values({
			id: "replay-operator-key",
			...hashApiKeyForStorage(operatorToken),
			projectId: "project-id",
			createdBy: "user-id",
			description: "Replay fixture",
		});
	});
	afterEach(async () => {
		await waitForPendingWork(5000);
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
	});

	test.each(["google", "anthropic", "responses"])(
		"replays %s tool/reasoning metadata through the signed route without a global cache",
		async (protocol) => {
			const providerId =
				protocol === "google"
					? "google-ai-studio"
					: protocol === "anthropic"
						? "anthropic"
						: "openai";
			const target: ProviderModelVerificationTarget = {
				providerId,
				modelName: "unpublished-replay-fixture",
				externalId: "exact-deployment",
				apiFormat:
					protocol === "responses" ? "openai-responses" : "provider-native",
				streaming: true,
				vision: false,
				audio: false,
				tools: true,
				jsonOutput: false,
				jsonOutputSchema: false,
				reasoning: true,
				reasoningMaxTokens: false,
				reasoningEfforts: null,
				webSearch: false,
			};
			await db.insert(tables.providerKey).values({
				id: "replay-provider-key",
				provider: providerId,
				managed: true,
				status: "inactive",
				tokenCiphertext: encryptProviderKey(
					providerToken,
					"replay-provider-key",
					"managed",
				),
				tokenHash: getApiKeyFingerprint(providerToken),
				tokenMasked: "fixture",
			});
			const nativeBodies: unknown[] = [];
			const normalized: string[] = [];
			const executed: string[] = [];
			vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
				const req = new Request(input, init);
				if (new URL(req.url).hostname === "gateway.example") {
					return await app.fetch(req);
				}
				expect(new URL(req.url).hostname).toBe("provider.example");
				expect(
					req.headers.get("authorization") === `Bearer ${operatorToken}`,
				).toBe(false);
				nativeBodies.push(await req.json());
				return new Response(
					frames(protocol, nativeBodies.length === 1)
						.map((frame) => `data: ${JSON.stringify(frame)}\n\n`)
						.join(""),
					{ headers: { "content-type": "text/event-stream" } },
				);
			});
			const cacheReads = vi.spyOn(redisClient, "get");
			const cacheWrites = vi.spyOn(redisClient, "setex");
			const outcome = await executeAgentRequest({
				client: { url: "https://benchmark.example/v1/chat/completions" },
				request: {
					messages: [{ role: "user", content: "Call ping, then finish." }],
				},
				model: target.modelName,
				timeoutMs: 5000,
				fetch: async (_input, init) => {
					const native = await prepareProviderModelVerificationRequest(
						JSON.parse(String(init?.body)) as ModelVerificationRequest,
						{
							target,
							token: providerToken,
							baseUrl: "https://provider.example",
							skipEnvVars: true,
						},
					);
					const response = await createAirsideGatewayFetch({
						runId: "replay-run",
						providerKeyId: "replay-provider-key",
						target,
						pricing: { inputPrice: "0.000001", outputPrice: "0.000002" },
						responseFormat: "openai-chat-completions",
					})(native.endpoint, {
						...init,
						method: "POST",
						headers: native.headers,
						body: JSON.stringify(native.payload),
					});
					normalized.push(await response.clone().text());
					return response;
				},
				agent: {
					maxTurns: 2,
					createSession: () => ({
						tools: [
							{
								type: "function",
								function: {
									name: "ping",
									parameters: {
										type: "object",
										properties: { value: { type: "number" } },
									},
								},
							},
						],
						callTool: (call) => {
							executed.push(call.function.arguments);
							return { content: "pong" };
						},
						evaluate: (response) => ({
							passed: response.content.includes("DONE"),
						}),
					}),
				},
				context: {
					caseId: "replay",
					run: 1,
					seed: 1,
					target: { id: "replay", model: target.modelName },
					warmup: false,
				},
			});
			expect(outcome.response.error).toBeNull();
			expect(outcome.evaluation?.passed).toBe(true);
			expect(outcome.response.agent?.turnCount).toBe(2);
			expect(nativeBodies).toHaveLength(2);
			expect(executed).toHaveLength(protocol === "google" ? 2 : 1);
			expect(
				cacheReads.mock.calls.filter(([key]) =>
					String(key).startsWith("thought_signature:"),
				),
			).toHaveLength(0);
			expect(
				cacheWrites.mock.calls.filter(([key]) =>
					String(key).startsWith("thought_signature:"),
				),
			).toHaveLength(0);
			if (protocol === "google") {
				const chunks = normalized[0]
					.split("\n")
					.filter(
						(line) => line.startsWith("data: ") && line !== "data: [DONE]",
					)
					.map(
						(line) =>
							JSON.parse(line.slice(6)) as {
								choices?: Array<{
									delta?: { tool_calls?: Array<{ index: number }> };
								}>;
							},
					);
				expect(
					chunks
						.flatMap((chunk) => chunk.choices?.[0]?.delta?.tool_calls ?? [])
						.map((call) => call.index),
				).toEqual([0, 1]);
				expect(nativeBodies[1]).toMatchObject({
					contents: expect.arrayContaining([
						expect.objectContaining({
							role: "model",
							parts: expect.arrayContaining([
								{
									text: "First",
									thoughtSignature: "first-text-signature-fixture",
								},
								{
									text: "Second",
									thoughtSignature: "second-text-signature-fixture",
								},
								expect.objectContaining({
									functionCall: { name: "ping", args: { value: 1 } },
									thoughtSignature: "first-tool-signature-fixture",
								}),
								expect.objectContaining({
									functionCall: { name: "ping", args: { value: 2 } },
									thoughtSignature: "second-tool-signature-fixture",
								}),
							]),
						}),
					]),
				});
			} else if (protocol === "anthropic") {
				expect(nativeBodies[1]).toMatchObject({
					messages: expect.arrayContaining([
						expect.objectContaining({
							role: "assistant",
							content: expect.arrayContaining([
								{
									type: "thinking",
									thinking: "thinking fixture",
									signature: "anthropic-signature-fixture",
								},
							]),
						}),
					]),
				});
			} else {
				expect(nativeBodies[1]).toMatchObject({
					input: expect.arrayContaining([
						expect.objectContaining({
							type: "reasoning",
							id: "reasoning-fixture",
							encrypted_content: "opaque-reasoning-fixture",
						}),
						expect.objectContaining({ role: "assistant", phase: "commentary" }),
					]),
				});
			}
		},
	);
});
