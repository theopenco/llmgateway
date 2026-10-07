import { createServer, type Server } from "node:http";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { encryptProviderKeyForStorage } from "@llmgateway/actions";
import { db, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

import { app } from "./app.js";
import { createGatewayApiTestHarness } from "./test-utils/gateway-api-test-harness.js";

type Block = Record<string, unknown> & { type: string };

describe("/v1/messages tool_result content markers", () => {
	createGatewayApiTestHarness();

	let server: Server;
	let baseUrl = "";
	let captured: Array<{ messages: Array<{ role: string; content: Block[] }> }> =
		[];

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
			id: "tool-result-marker-key",
			...hashApiKeyForStorage("tool-result-marker-token"),
			projectId: "project-id",
			description: "Tool result markers",
			createdBy: "user-id",
		});
		await db.insert(tables.providerKey).values({
			id: "anthropic-tool-result-key",
			...encryptProviderKeyForStorage(
				"mock-provider-key",
				"anthropic-tool-result-key",
				"org-id",
			),
			provider: "anthropic",
			organizationId: "org-id",
			baseUrl,
		});
	}

	// Claude's tool loop: the client marks the newest result, so the marker
	// moves to a later result on every request.
	async function send(markedResult: number) {
		const results = [0, 1].map((index) => ({
			type: "tool_result",
			tool_use_id: `toolu_${index}`,
			content: [
				{
					type: "text",
					text: `result ${index}`,
					...(index === markedResult && {
						cache_control: { type: "ephemeral" },
					}),
				},
			],
		}));
		const res = await app.request("/v1/messages", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer tool-result-marker-token",
				"x-no-fallback": "true",
				"x-no-cache": "true",
			},
			body: JSON.stringify({
				model: "anthropic/claude-opus-4-6",
				max_tokens: 1024,
				messages: [
					{ role: "user", content: "Run both tools." },
					...[0, 1].flatMap((index) => [
						{
							role: "assistant",
							content: [
								{
									type: "tool_use",
									id: `toolu_${index}`,
									name: "lookup",
									input: {},
								},
							],
						},
						{ role: "user", content: [results[index]] },
					]),
				],
			}),
		});
		expect(res.status).toBe(200);
		return captured
			.at(-1)!
			.messages.flatMap((message) => message.content)
			.filter((block) => block.type === "tool_result");
	}

	test("keeps tool result text stable when the marker moves", async () => {
		await setup();

		const first = await send(0);
		const second = await send(1);

		expect(first[0]!.content).toEqual(second[0]!.content);
		expect(first.map((block) => block.cache_control)).toEqual([
			{ type: "ephemeral" },
			undefined,
		]);
		expect(second.map((block) => block.cache_control)).toEqual([
			undefined,
			{ type: "ephemeral" },
		]);
	});
});
