import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { app } from "@/app.js";
import {
	isInvalidThinkingSignatureError,
	stripAnthropicThinking,
} from "@/chat/tools/reasoning-credential-pin.js";
import { createGatewayApiTestHarness } from "@/test-utils/gateway-api-test-harness.js";
import { waitForLogs } from "@/test-utils/test-helpers.js";

import { encryptProviderKeyForStorage } from "@llmgateway/actions";
import { cdb, db, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

const SIGNATURE_ERROR =
	'messages.1.content.0: Invalid `signature` in `thinking` block. The block is bound to a different conversation. Remove the block, or set `thinking.block_binding.prefix_mismatch_behavior` to "drop_block".';

const thinking = (signature: string) => ({
	type: "reasoning.text",
	text: "Thinking",
	signature,
	format: "anthropic-claude-v1",
	block_index: 0,
});

describe("anthropic thinking signature retry", () => {
	const harness = createGatewayApiTestHarness();
	let previousEnvKey: string | undefined;

	beforeEach(async () => {
		previousEnvKey = process.env.LLM_ANTHROPIC_API_KEY;
		delete process.env.LLM_ANTHROPIC_API_KEY;
		await db.insert(tables.apiKey).values({
			id: "token-id",
			...hashApiKeyForStorage("real-token"),
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});
		await cdb.insert(tables.providerKey).values({
			id: "managed-anthropic",
			provider: "anthropic",
			...encryptProviderKeyForStorage("sk-ant", "managed-anthropic", null),
			managed: true,
			organizationId: null,
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
		if (previousEnvKey === undefined) {
			delete process.env.LLM_ANTHROPIC_API_KEY;
		} else {
			process.env.LLM_ANTHROPIC_API_KEY = previousEnvKey;
		}
	});

	const sse = (events: object[]) =>
		events
			.map(
				(event) =>
					`event: ${(event as { type: string }).type}\ndata: ${JSON.stringify(event)}\n\n`,
			)
			.join("");

	/** Rejects requests `reject` matches with the signature error. */
	function mockUpstream(
		reject: (body: string) => boolean = (body) =>
			body.includes('"type":"thinking"'),
	): string[] {
		const bodies: string[] = [];
		vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
			const body = typeof init?.body === "string" ? init.body : "";
			bodies.push(body);
			if (reject(body)) {
				return new Response(
					JSON.stringify({
						type: "error",
						error: { type: "invalid_request_error", message: SIGNATURE_ERROR },
					}),
					{ status: 400, headers: { "Content-Type": "application/json" } },
				);
			}
			const usage = { input_tokens: 5, output_tokens: 5 };
			if (body.includes('"stream":true')) {
				return new Response(
					sse([
						{
							type: "message_start",
							message: {
								id: "msg_retry",
								type: "message",
								role: "assistant",
								model: "claude-sonnet-4-6",
								content: [],
								usage,
							},
						},
						{
							type: "content_block_start",
							index: 0,
							content_block: { type: "text", text: "" },
						},
						{
							type: "content_block_delta",
							index: 0,
							delta: { type: "text_delta", text: "Done" },
						},
						{ type: "content_block_stop", index: 0 },
						{
							type: "message_delta",
							delta: { stop_reason: "end_turn" },
							usage,
						},
						{ type: "message_stop" },
					]),
					{ status: 200, headers: { "Content-Type": "text/event-stream" } },
				);
			}
			return new Response(
				JSON.stringify({
					id: "msg_retry",
					type: "message",
					role: "assistant",
					model: "claude-sonnet-4-6",
					content: [{ type: "text", text: "Done" }],
					stop_reason: "end_turn",
					usage,
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);
		});
		return bodies;
	}

	/** One assistant turn per signature, oldest first. */
	function turn(signatures: string[], stream = false, system = "Agent") {
		const messages: unknown[] = [
			{ role: "system", content: system },
			{ role: "user", content: "Start" },
		];
		for (const signature of signatures) {
			messages.push(
				{
					role: "assistant",
					content: "Done",
					reasoning_details: [thinking(`anthropic:${signature}`)],
				},
				{ role: "user", content: "Continue" },
			);
		}
		return app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				Authorization: "Bearer real-token",
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				model: "anthropic/claude-sonnet-4-6",
				messages,
				stream,
			}),
		});
	}

	const replaysThinking = (body: string) => body.includes('"type":"thinking"');

	test("retries once without thinking blocks the upstream rejects", async () => {
		await harness.setProjectMode("credits");
		const bodies = mockUpstream();

		const res = await turn(["stale-signature"]);

		expect(res.status).toBe(200);
		expect(bodies.map(replaysThinking)).toEqual([true, false]);

		const logs = await waitForLogs(2);
		const failed = logs.find((log) => log.hasError);
		const success = logs.find((log) => !log.hasError);
		expect(failed?.retried).toBe(true);
		expect(failed?.retriedByLogId).toBe(success?.id);
		expect(success?.unifiedFinishReason).toBe("completed");
	});

	test("retries a streaming request the same way", async () => {
		await harness.setProjectMode("credits");
		const bodies = mockUpstream();

		const res = await turn(["stale-signature"], true);

		expect(res.status).toBe(200);
		expect(await res.text()).toContain("Done");
		expect(bodies.map(replaysThinking)).toEqual([true, false]);
	});

	test("later turns leave rejected thinking out and replay newer thinking", async () => {
		await harness.setProjectMode("credits");
		const bodies = mockUpstream((body) => body.includes("stale-signature"));

		expect((await turn(["stale-signature"])).status).toBe(200);
		expect(bodies).toHaveLength(2);

		const res = await turn(["stale-signature", "fresh-signature"]);
		expect(res.status).toBe(200);
		expect(bodies).toHaveLength(3);
		expect(bodies[2]).not.toContain("stale-signature");
		expect(bodies[2]).toContain("fresh-signature");
	});

	test("a rejection only holds under the system prompt it came with", async () => {
		await harness.setProjectMode("credits");
		const bodies = mockUpstream(
			(body) =>
				body.includes("Summarizer") && body.includes('"type":"thinking"'),
		);

		expect((await turn(["signature"], false, "Summarizer")).status).toBe(200);
		expect(bodies).toHaveLength(2);

		expect((await turn(["signature"])).status).toBe(200);
		expect(bodies).toHaveLength(3);
		expect(replaysThinking(bodies[2])).toBe(true);
	});

	test("does not retry a rejected replay more than once", async () => {
		await harness.setProjectMode("credits");
		const bodies = mockUpstream(() => true);

		const res = await turn(["stale-signature"]);

		expect(res.status).toBe(400);
		expect(bodies.map(replaysThinking)).toEqual([true, false]);
	});
});

describe("stripAnthropicThinking", () => {
	test("drops Anthropic thinking and keeps other reasoning", () => {
		const encrypted = {
			type: "reasoning.encrypted",
			data: "x",
			format: "openai-responses-v1",
		};
		const { messages, stripped } = stripAnthropicThinking([
			{ role: "user", content: "Start" },
			{
				role: "assistant",
				content: null,
				reasoning_details: [thinking("a:1")],
			},
			{
				role: "assistant",
				content: "Done",
				reasoning_details: [thinking("a:2"), encrypted],
			},
		]);
		expect(stripped).toBe(true);
		expect(messages).toEqual([
			{ role: "user", content: "Start" },
			{ role: "assistant", content: "Done", reasoning_details: [encrypted] },
		]);
	});

	test("reports nothing stripped without Anthropic thinking", () => {
		expect(
			stripAnthropicThinking([{ role: "assistant", content: "Done" }]).stripped,
		).toBe(false);
	});
});

describe("isInvalidThinkingSignatureError", () => {
	test("matches Anthropic signature rejections only", () => {
		expect(isInvalidThinkingSignatureError(SIGNATURE_ERROR)).toBe(true);
		expect(
			isInvalidThinkingSignatureError(
				"messages.2: `tool_use` ids were found without `tool_result` blocks",
			),
		).toBe(false);
		expect(isInvalidThinkingSignatureError(undefined)).toBe(false);
	});
});
