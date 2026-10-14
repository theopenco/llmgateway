import { createServer, type Server } from "node:http";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { encryptProviderKeyForStorage } from "@llmgateway/actions";
import { db, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

import { app } from "./app.js";
import { createGatewayApiTestHarness } from "./test-utils/gateway-api-test-harness.js";

describe("/v1/messages tool_choice", () => {
	createGatewayApiTestHarness();

	let server: Server;
	let baseUrl = "";
	let captured: Array<Record<string, unknown>> = [];

	beforeAll(async () => {
		server = createServer((req, res) => {
			let body = "";
			req.on("data", (chunk) => (body += chunk));
			req.on("end", () => {
				captured.push(JSON.parse(body));
				res.writeHead(200, { "content-type": "application/json" });
				res.end(
					JSON.stringify({
						id: "msg_mock",
						type: "message",
						role: "assistant",
						model: "claude-opus-4-6",
						content: [{ type: "text", text: "Done." }],
						stop_reason: "end_turn",
						usage: { input_tokens: 9, output_tokens: 4 },
					}),
				);
			});
		});
		baseUrl = await new Promise<string>((resolve) => {
			server.listen(0, () => {
				const address = server.address();
				resolve(
					`http://localhost:${typeof address === "object" && address ? address.port : 0}`,
				);
			});
		});
	});

	afterAll(async () => {
		await new Promise<void>((resolve, reject) => {
			server.close((err) => (err ? reject(err) : resolve()));
		});
	});

	async function setup() {
		captured = [];
		await db.insert(tables.apiKey).values({
			id: "tool-choice-key",
			...hashApiKeyForStorage("tool-choice-token"),
			projectId: "project-id",
			description: "Tool choice",
			createdBy: "user-id",
		});
		await db.insert(tables.providerKey).values({
			id: "anthropic-tool-choice-key",
			...encryptProviderKeyForStorage(
				"mock-provider-key",
				"anthropic-tool-choice-key",
				"org-id",
			),
			provider: "anthropic",
			organizationId: "org-id",
			baseUrl,
		});
	}

	async function send(toolChoice: unknown) {
		const res = await app.request("/v1/messages", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer tool-choice-token",
				"x-no-fallback": "true",
				"x-no-cache": "true",
			},
			body: JSON.stringify({
				model: "anthropic/claude-sonnet-4-6",
				max_tokens: 64,
				messages: [{ role: "user", content: "What's the weather?" }],
				tools: [
					{
						name: "get_weather",
						description: "Weather lookup",
						input_schema: { type: "object", properties: {} },
					},
					{
						name: "get_time",
						description: "Time lookup",
						input_schema: { type: "object", properties: {} },
					},
				],
				tool_choice: toolChoice,
			}),
		});
		expect(res.status).toBe(200);
		return captured.at(-1)!;
	}

	test("forwards forced tool modes to Anthropic", async () => {
		await setup();

		expect((await send({ type: "any" })).tool_choice).toEqual({ type: "any" });
		expect(
			(await send({ type: "tool", name: "get_time" })).tool_choice,
		).toEqual({ type: "tool", name: "get_time" });
		expect((await send({ type: "none" })).tool_choice).toEqual({
			type: "none",
		});
		// auto is Anthropic's default, so it is left off the upstream body
		expect((await send({ type: "auto" })).tool_choice).toBeUndefined();
	});

	test("drops OpenAI-style tool_choice values instead of rejecting them", async () => {
		await setup();

		expect((await send("required")).tool_choice).toBeUndefined();
		expect(
			(await send({ type: "function", function: { name: "get_time" } }))
				.tool_choice,
		).toBeUndefined();
	});

	test("rejects a named tool_choice without a name", async () => {
		await setup();

		const res = await app.request("/v1/messages", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer tool-choice-token",
			},
			body: JSON.stringify({
				model: "anthropic/claude-sonnet-4-6",
				max_tokens: 64,
				messages: [{ role: "user", content: "hi" }],
				tool_choice: { type: "tool" },
			}),
		});
		expect(res.status).toBe(400);
		expect(captured).toHaveLength(0);
	});
});
