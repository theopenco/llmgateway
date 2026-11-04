import { createServer, type Server } from "node:http";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { encryptProviderKeyForStorage } from "@llmgateway/actions";
import { db, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

import { app } from "./app.js";
import { createGatewayApiTestHarness } from "./test-utils/gateway-api-test-harness.js";

// Anthropic ends a tool-call stream with message_delta {stop_reason: "tool_use"}
// followed by a bare message_stop. The second event used to be translated into
// a finish_reason "stop" chunk, so clients that keep the last finish_reason
// (including /v1/messages) reported end_turn for a tool call.
describe("Anthropic streaming stop reason", () => {
	createGatewayApiTestHarness();

	let server: Server;
	let baseUrl = "";

	const frame = (event: string, data: unknown) =>
		`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
	const sse = [
		frame("message_start", {
			type: "message_start",
			message: {
				id: "msg_stream_tool",
				type: "message",
				role: "assistant",
				model: "claude-sonnet-4-6",
				content: [],
				usage: { input_tokens: 20, output_tokens: 0 },
			},
		}),
		frame("content_block_start", {
			type: "content_block_start",
			index: 0,
			content_block: {
				type: "tool_use",
				id: "toolu_01TIME",
				name: "get_time",
				input: {},
			},
		}),
		frame("content_block_delta", {
			type: "content_block_delta",
			index: 0,
			delta: { type: "input_json_delta", partial_json: "{}" },
		}),
		frame("content_block_stop", { type: "content_block_stop", index: 0 }),
		frame("message_delta", {
			type: "message_delta",
			delta: { stop_reason: "tool_use", stop_sequence: null },
			usage: { output_tokens: 8 },
		}),
		frame("message_stop", { type: "message_stop" }),
	].join("");

	beforeAll(async () => {
		server = createServer((req, res) => {
			req.on("data", () => {});
			req.on("end", () => {
				res.writeHead(200, { "content-type": "text/event-stream" });
				res.end(sse);
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
		await db.insert(tables.apiKey).values({
			id: "stop-reason-key",
			...hashApiKeyForStorage("stop-reason-token"),
			projectId: "project-id",
			description: "Stop reason",
			createdBy: "user-id",
		});
		await db.insert(tables.providerKey).values({
			id: "anthropic-stop-reason-key",
			...encryptProviderKeyForStorage(
				"mock-provider-key",
				"anthropic-stop-reason-key",
				"org-id",
			),
			provider: "anthropic",
			organizationId: "org-id",
			baseUrl,
		});
	}

	const headers = {
		"Content-Type": "application/json",
		Authorization: "Bearer stop-reason-token",
		"x-no-fallback": "true",
		"x-no-cache": "true",
	};

	function parseEvents(text: string): Array<Record<string, any>> {
		return text
			.split("\n")
			.filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
			.map((line) => JSON.parse(line.slice(6)));
	}

	test("/v1/chat/completions emits a single finish_reason of tool_calls", async () => {
		await setup();

		const res = await app.request("/v1/chat/completions", {
			method: "POST",
			headers,
			body: JSON.stringify({
				model: "anthropic/claude-sonnet-4-6",
				stream: true,
				messages: [{ role: "user", content: "What time is it?" }],
				tools: [
					{
						type: "function",
						function: {
							name: "get_time",
							parameters: { type: "object", properties: {} },
						},
					},
				],
			}),
		});
		expect(res.status).toBe(200);

		const finishReasons = parseEvents(await res.text())
			.flatMap((chunk) => chunk.choices ?? [])
			.map((choice) => choice.finish_reason)
			.filter((reason) => reason !== null && reason !== undefined);
		expect(finishReasons).toEqual(["tool_calls"]);
	});

	test("/v1/messages reports stop_reason tool_use", async () => {
		await setup();

		const res = await app.request("/v1/messages", {
			method: "POST",
			headers,
			body: JSON.stringify({
				model: "anthropic/claude-sonnet-4-6",
				max_tokens: 64,
				stream: true,
				messages: [{ role: "user", content: "What time is it?" }],
				tools: [
					{
						name: "get_time",
						description: "Time lookup",
						input_schema: { type: "object", properties: {} },
					},
				],
			}),
		});
		expect(res.status).toBe(200);

		const events = parseEvents(await res.text());
		const messageDeltas = events.filter((e) => e.type === "message_delta");
		expect(messageDeltas).toHaveLength(1);
		expect(messageDeltas[0].delta.stop_reason).toBe("tool_use");
		expect(events.filter((e) => e.type === "message_stop")).toHaveLength(1);
	});
});
