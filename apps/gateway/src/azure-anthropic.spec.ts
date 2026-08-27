import { createServer, type Server } from "node:http";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { db, tables } from "@llmgateway/db";

import { app } from "./app.js";
import { createGatewayApiTestHarness } from "./test-utils/gateway-api-test-harness.js";

interface CapturedRequest {
	url: string;
	headers: Record<string, string | string[] | undefined>;
	body: Record<string, unknown>;
}

/**
 * Claude on Microsoft Foundry speaks the Anthropic Messages API, not an
 * OpenAI-compatible one. These tests stand up a mock Foundry endpoint and
 * assert the gateway talks to it the way Microsoft documents: a POST to
 * `/anthropic/v1/messages` authenticated with `x-api-key` plus an
 * `anthropic-version` header, carrying an Anthropic-shaped body.
 */
describe("azure-anthropic", () => {
	// Registers the shared reset/seed hooks; this suite drives the gateway
	// through its own mock Foundry server rather than the harness mock.
	createGatewayApiTestHarness();

	let foundryServer: Server;
	let foundryUrl = "";
	let captured: CapturedRequest[] = [];

	beforeAll(async () => {
		foundryServer = createServer((req, res) => {
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
								id: "msg_foundry_1",
								model: "claude-opus-4-8",
								usage: { input_tokens: 9, output_tokens: 1 },
							},
						},
						{
							type: "content_block_delta",
							index: 0,
							delta: { type: "text_delta", text: "Hello from Foundry" },
						},
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
						id: "msg_foundry_1",
						type: "message",
						role: "assistant",
						model: "claude-opus-4-8",
						content: [{ type: "text", text: "Hello from Foundry" }],
						stop_reason: "end_turn",
						usage: { input_tokens: 9, output_tokens: 4 },
					}),
				);
			});
		});

		foundryUrl = await new Promise<string>((resolve) => {
			foundryServer.listen(0, () => {
				const address = foundryServer.address();
				resolve(
					`http://localhost:${typeof address === "object" && address ? address.port : 0}`,
				);
			});
		});
	});

	afterAll(async () => {
		await new Promise<void>((resolve, reject) => {
			foundryServer.close((err) => (err ? reject(err) : resolve()));
		});
	});

	async function setup(token: string) {
		captured = [];
		await db.insert(tables.apiKey).values({
			id: `${token}-id`,
			token,
			projectId: "project-id",
			description: "Azure Anthropic test key",
			createdBy: "user-id",
		});
		await db.insert(tables.providerKey).values({
			id: "azure-anthropic-key-id",
			token: "foundry-api-key",
			provider: "azure-anthropic",
			organizationId: "org-id",
			baseUrl: foundryUrl,
		});
	}

	test("routes a non-streaming request through the Foundry Messages API", async () => {
		await setup("azure-anthropic-token");

		const res = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer azure-anthropic-token",
				"x-no-fallback": "true",
			},
			body: JSON.stringify({
				model: "azure-anthropic/claude-opus-4-8",
				messages: [{ role: "user", content: "Say hi" }],
			}),
		});

		expect(res.status).toBe(200);
		const json = (await res.json()) as {
			choices: { message: { content: string } }[];
			usage: { prompt_tokens: number; completion_tokens: number };
		};
		expect(json.choices[0].message.content).toBe("Hello from Foundry");
		expect(json.usage.prompt_tokens).toBe(9);
		expect(json.usage.completion_tokens).toBe(4);

		expect(captured).toHaveLength(1);
		const upstream = captured[0];
		expect(upstream.url).toBe("/anthropic/v1/messages");
		expect(upstream.headers["x-api-key"]).toBe("foundry-api-key");
		expect(upstream.headers["anthropic-version"]).toBe("2023-06-01");
		// Azure's own `api-key` header would be rejected on this route.
		expect(upstream.headers["api-key"]).toBeUndefined();
		// The deployment name is the model, and the body is Anthropic-shaped.
		expect(upstream.body.model).toBe("claude-opus-4-8");
		expect(upstream.body.anthropic_version).toBeUndefined();
		expect(upstream.body.messages).toEqual([
			{ role: "user", content: [{ type: "text", text: "Say hi" }] },
		]);
	});

	test("streams Anthropic events back as OpenAI chunks", async () => {
		await setup("azure-anthropic-stream-token");

		const res = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer azure-anthropic-stream-token",
				"x-no-fallback": "true",
			},
			body: JSON.stringify({
				model: "azure-anthropic/claude-opus-4-8",
				messages: [{ role: "user", content: "Say hi" }],
				stream: true,
			}),
		});

		expect(res.status).toBe(200);
		const text = await res.text();
		expect(text).toContain("Hello from Foundry");
		expect(text).toContain('"finish_reason":"stop"');
		expect(text).toContain("data: [DONE]");

		expect(captured).toHaveLength(1);
		expect(captured[0].url).toBe("/anthropic/v1/messages");
		expect(captured[0].body.stream).toBe(true);
	});
});
