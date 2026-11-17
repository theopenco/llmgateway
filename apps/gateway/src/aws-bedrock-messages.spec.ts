import { createServer, type Server } from "node:http";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { encryptProviderKeyForStorage } from "@llmgateway/actions";
import { db, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

import { app } from "./app.js";
import { createGatewayApiTestHarness } from "./test-utils/gateway-api-test-harness.js";

interface CapturedRequest {
	url: string;
	headers: Record<string, string | string[] | undefined>;
	body: Record<string, unknown>;
}

const THINKING = {
	type: "thinking",
	thinking: "Greet them.",
	signature: "bedrock-signature",
};

/**
 * Claude on AWS Bedrock goes through Bedrock's Anthropic Messages API
 * (`/anthropic/v1/messages`), which takes the inference profile as the body's
 * model. These tests stand up a mock Bedrock endpoint for it.
 */
describe("aws-bedrock Messages API", () => {
	createGatewayApiTestHarness();

	let bedrockServer: Server;
	let bedrockUrl = "";
	let captured: CapturedRequest[] = [];

	beforeAll(async () => {
		bedrockServer = createServer((req, res) => {
			let body = "";
			req.on("data", (chunk) => (body += chunk));
			req.on("end", () => {
				const parsed = JSON.parse(body || "{}") as Record<string, unknown>;
				captured.push({
					url: req.url ?? "",
					headers: req.headers,
					body: parsed,
				});

				if (parsed.stream === true) {
					res.writeHead(200, { "content-type": "text/event-stream" });
					for (const event of [
						{
							type: "message_start",
							message: {
								id: "msg_bdrk_1",
								model: "claude-opus-5-5",
								usage: { input_tokens: 9, output_tokens: 1 },
							},
						},
						{
							type: "content_block_start",
							index: 0,
							content_block: { type: "thinking", thinking: "" },
						},
						{
							type: "content_block_delta",
							index: 0,
							delta: { type: "thinking_delta", thinking: THINKING.thinking },
						},
						{
							type: "content_block_delta",
							index: 0,
							delta: { type: "signature_delta", signature: THINKING.signature },
						},
						{ type: "content_block_stop", index: 0 },
						{
							type: "content_block_start",
							index: 1,
							content_block: { type: "text", text: "" },
						},
						{
							type: "content_block_delta",
							index: 1,
							delta: { type: "text_delta", text: "Hello from Bedrock" },
						},
						{ type: "content_block_stop", index: 1 },
						{
							type: "message_delta",
							delta: { stop_reason: "end_turn" },
							usage: { output_tokens: 4 },
						},
						{ type: "message_stop" },
					]) {
						res.write(
							`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
						);
					}
					res.end();
					return;
				}

				res.writeHead(200, { "content-type": "application/json" });
				res.end(
					JSON.stringify({
						id: "msg_bdrk_1",
						type: "message",
						role: "assistant",
						model: "claude-opus-5-5",
						content: [THINKING, { type: "text", text: "Hello from Bedrock" }],
						stop_reason: "end_turn",
						usage: {
							input_tokens: 9,
							cache_creation_input_tokens: 0,
							cache_read_input_tokens: 0,
							output_tokens: 4,
						},
					}),
				);
			});
		});

		bedrockUrl = await new Promise<string>((resolve) => {
			bedrockServer.listen(0, () => {
				const address = bedrockServer.address();
				resolve(
					`http://localhost:${typeof address === "object" && address ? address.port : 0}`,
				);
			});
		});
	});

	afterAll(async () => {
		await new Promise<void>((resolve, reject) => {
			bedrockServer.close((err) => (err ? reject(err) : resolve()));
		});
	});

	async function setup(token: string) {
		captured = [];
		await db.insert(tables.apiKey).values({
			id: `${token}-id`,
			...hashApiKeyForStorage(token),
			projectId: "project-id",
			description: "AWS Bedrock test key",
			createdBy: "user-id",
		});
		await db.insert(tables.providerKey).values({
			id: "aws-bedrock-key-id",
			...encryptProviderKeyForStorage(
				"bedrock-api-key",
				"aws-bedrock-key-id",
				"org-id",
			),
			provider: "aws-bedrock",
			organizationId: "org-id",
			baseUrl: bedrockUrl,
		});
	}

	async function request(token: string, body: Record<string, unknown>) {
		return await app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${token}`,
				"x-no-fallback": "true",
			},
			body: JSON.stringify({
				model: "aws-bedrock/claude-opus-5-5",
				...body,
			}),
		});
	}

	test("sends an Anthropic body with the inference profile as its model", async () => {
		await setup("aws-bedrock-messages-token");

		const res = await request("aws-bedrock-messages-token", {
			messages: [{ role: "user", content: "Say hi" }],
		});

		expect(res.status).toBe(200);
		const json = (await res.json()) as {
			choices: {
				message: {
					content: string;
					reasoning_details?: { signature?: string }[];
				};
				finish_reason: string;
			}[];
			usage: { prompt_tokens: number; completion_tokens: number };
		};
		expect(json.choices[0].message.content).toBe("Hello from Bedrock");
		expect(json.choices[0].finish_reason).toBe("stop");
		expect(json.usage.prompt_tokens).toBe(9);
		expect(json.usage.completion_tokens).toBe(4);
		// Bedrock's signature verifies only on Bedrock.
		expect(json.choices[0].message.reasoning_details?.[0]?.signature).toBe(
			"aws-bedrock:bedrock-signature",
		);

		expect(captured).toHaveLength(1);
		const upstream = captured[0];
		expect(upstream.url).toBe("/anthropic/v1/messages");
		expect(upstream.headers["x-api-key"]).toBe("bedrock-api-key");
		expect(upstream.headers["anthropic-version"]).toBe("2023-06-01");
		expect(upstream.body.model).toBe("global.anthropic.claude-opus-5-5");
		expect(upstream.body).not.toHaveProperty("metadata");
		expect(upstream.body.messages).toEqual([
			{ role: "user", content: [{ type: "text", text: "Say hi" }] },
		]);
	});

	test("streams Anthropic events back as OpenAI chunks", async () => {
		await setup("aws-bedrock-messages-stream-token");

		const res = await request("aws-bedrock-messages-stream-token", {
			messages: [{ role: "user", content: "Say hi" }],
			stream: true,
		});

		expect(res.status).toBe(200);
		const text = await res.text();
		expect(text).toContain("Hello from Bedrock");
		expect(text).toContain("aws-bedrock:bedrock-signature");
		expect(text).toContain('"finish_reason":"stop"');
		expect(text).toContain("data: [DONE]");

		expect(captured).toHaveLength(1);
		expect(captured[0].url).toBe("/anthropic/v1/messages");
		expect(captured[0].body.stream).toBe(true);
	});

	test("replays Bedrock's own thinking unsealed", async () => {
		await setup("aws-bedrock-messages-replay-token");

		const res = await request("aws-bedrock-messages-replay-token", {
			messages: [
				{ role: "user", content: "Say hi" },
				{
					role: "assistant",
					content: "Hello from Bedrock",
					reasoning_details: [
						{
							type: "reasoning.text",
							text: THINKING.thinking,
							signature: "aws-bedrock:bedrock-signature",
							format: "anthropic-claude-v1",
							block_index: 0,
						},
					],
				},
				{ role: "user", content: "Again" },
			],
		});

		expect(res.status).toBe(200);
		const assistant = (
			captured[0].body.messages as { role: string; content: unknown[] }[]
		).find((message) => message.role === "assistant");
		expect(assistant?.content[0]).toEqual(THINKING);
	});
});
