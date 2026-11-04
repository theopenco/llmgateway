import { createServer, type Server } from "node:http";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { encryptProviderKeyForStorage } from "@llmgateway/actions";
import { db, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

import { app } from "./app.js";
import { createGatewayApiTestHarness } from "./test-utils/gateway-api-test-harness.js";

// 1x1 transparent PNG
const PNG_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

const weatherTool = {
	name: "get_weather",
	description: "Weather lookup",
	input_schema: {
		type: "object",
		properties: { city: { type: "string" } },
		required: ["city"],
	},
};

describe("/v1/messages tool definition and tool_result fidelity", () => {
	createGatewayApiTestHarness();

	let server: Server;
	let baseUrl = "";
	let captured: Array<Record<string, any>> = [];

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
						model: "claude-sonnet-4-6",
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
			id: "fidelity-key",
			...hashApiKeyForStorage("fidelity-token"),
			projectId: "project-id",
			description: "Fidelity",
			createdBy: "user-id",
		});
		await db.insert(tables.providerKey).values({
			id: "anthropic-fidelity-key",
			...encryptProviderKeyForStorage(
				"mock-provider-key",
				"anthropic-fidelity-key",
				"org-id",
			),
			provider: "anthropic",
			organizationId: "org-id",
			baseUrl,
		});
	}

	async function send(body: Record<string, unknown>) {
		const res = await app.request("/v1/messages", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer fidelity-token",
				"x-no-fallback": "true",
				"x-no-cache": "true",
			},
			body: JSON.stringify({
				model: "anthropic/claude-sonnet-4-6",
				max_tokens: 64,
				...body,
			}),
		});
		expect(res.status).toBe(200);
		return captured.at(-1)!;
	}

	test("forwards strict, allowed_callers and eager_input_streaming on custom tools", async () => {
		await setup();

		const upstream = await send({
			messages: [{ role: "user", content: "Weather in Paris?" }],
			tools: [
				{
					...weatherTool,
					strict: true,
					allowed_callers: ["code_execution"],
					eager_input_streaming: true,
				},
				{ ...weatherTool, name: "get_time" },
			],
		});
		expect(upstream.tools[0]).toMatchObject({
			name: "get_weather",
			strict: true,
			allowed_callers: ["code_execution"],
			eager_input_streaming: true,
		});
		expect(upstream.tools[1]).not.toHaveProperty("strict");
		expect(upstream.tools[1]).not.toHaveProperty("allowed_callers");
		expect(upstream.tools[1]).not.toHaveProperty("eager_input_streaming");
	});

	test("keeps an image inside a tool_result as an image block", async () => {
		await setup();

		const upstream = await send({
			messages: [
				{ role: "user", content: "Take a screenshot." },
				{
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "toolu_01SHOT",
							name: "screenshot",
							input: {},
						},
					],
				},
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "toolu_01SHOT",
							content: [
								{ type: "text", text: "Captured:" },
								{
									type: "image",
									source: {
										type: "base64",
										media_type: "image/png",
										data: PNG_BASE64,
									},
								},
							],
						},
					],
				},
			],
			tools: [
				{
					name: "screenshot",
					description: "Capture the screen",
					input_schema: { type: "object", properties: {} },
				},
			],
		});

		const toolResult = upstream.messages
			.flatMap((m: { content: unknown }) =>
				Array.isArray(m.content) ? m.content : [],
			)
			.find((block: { type: string }) => block.type === "tool_result");
		expect(toolResult.tool_use_id).toBe("toolu_01SHOT");
		expect(toolResult.content).toEqual([
			{ type: "text", text: "Captured:" },
			{
				type: "image",
				source: {
					type: "base64",
					media_type: "image/png",
					data: PNG_BASE64,
				},
			},
		]);
	});

	test("text-only tool_result arrays keep their stringified form", async () => {
		await setup();

		const upstream = await send({
			messages: [
				{ role: "user", content: "Weather in Paris?" },
				{
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "toolu_01TXT",
							name: "get_weather",
							input: { city: "Paris" },
						},
					],
				},
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "toolu_01TXT",
							content: [{ type: "text", text: "Sunny" }],
						},
					],
				},
			],
			tools: [weatherTool],
		});

		const toolResult = upstream.messages
			.flatMap((m: { content: unknown }) =>
				Array.isArray(m.content) ? m.content : [],
			)
			.find((block: { type: string }) => block.type === "tool_result");
		expect(toolResult.content).toBe(
			JSON.stringify([{ type: "text", text: "Sunny" }]),
		);
	});
});
