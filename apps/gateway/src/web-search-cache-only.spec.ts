import { createServer, type Server } from "node:http";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { encryptProviderKeyForStorage } from "@llmgateway/actions";
import { db, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

import { app } from "./app.js";
import { createGatewayApiTestHarness } from "./test-utils/gateway-api-test-harness.js";

// Codex CLI's default (`web_search = "cached"`) sends this on every request.
const CACHED_SEARCH = { type: "web_search", external_web_access: false };

const functionTool = {
	type: "function",
	name: "shell",
	description: "Run a command",
	parameters: { type: "object", properties: { cmd: { type: "string" } } },
};

describe("cache-only web search (external_web_access: false)", () => {
	createGatewayApiTestHarness();

	let server: Server;
	let baseUrl = "";
	let captured: Array<{ url: string; body: Record<string, any> }> = [];

	beforeAll(async () => {
		server = createServer((req, res) => {
			let body = "";
			req.on("data", (chunk) => (body += chunk));
			req.on("end", () => {
				const url = req.url ?? "";
				captured.push({ url, body: JSON.parse(body) });
				res.writeHead(200, { "content-type": "application/json" });
				res.end(
					JSON.stringify(
						url.endsWith("/responses")
							? {
									id: "resp_mock",
									object: "response",
									created_at: 0,
									status: "completed",
									model: "gpt-5",
									output: [
										{
											type: "message",
											id: "msg_mock",
											role: "assistant",
											status: "completed",
											content: [
												{ type: "output_text", text: "Done.", annotations: [] },
											],
										},
									],
									usage: {
										input_tokens: 9,
										output_tokens: 4,
										total_tokens: 13,
									},
								}
							: {
									id: "chatcmpl-mock",
									object: "chat.completion",
									created: 0,
									model: "deepseek-v4-pro",
									choices: [
										{
											index: 0,
											message: { role: "assistant", content: "Done." },
											finish_reason: "stop",
										},
									],
									usage: {
										prompt_tokens: 9,
										completion_tokens: 4,
										total_tokens: 13,
									},
								},
					),
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

	async function setup(provider: "deepseek" | "openai") {
		captured = [];
		await db.insert(tables.apiKey).values({
			id: "cache-search-key",
			...hashApiKeyForStorage("cache-search-token"),
			projectId: "project-id",
			description: "Cache-only search",
			createdBy: "user-id",
		});
		await db.insert(tables.providerKey).values({
			id: `${provider}-cache-search-key`,
			...encryptProviderKeyForStorage(
				"mock-provider-key",
				`${provider}-cache-search-key`,
				"org-id",
			),
			provider,
			organizationId: "org-id",
			baseUrl,
		});
	}

	function send(path: string, body: Record<string, unknown>) {
		return app.request(path, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer cache-search-token",
				"x-no-fallback": "true",
				"x-no-cache": "true",
			},
			body: JSON.stringify(body),
		});
	}

	test("drops it on a model without native web search instead of a 400", async () => {
		await setup("deepseek");

		const res = await send("/v1/responses", {
			model: "deepseek/deepseek-v4-pro",
			input: "say hi",
			tools: [functionTool, CACHED_SEARCH],
		});

		expect(res.status).toBe(200);
		const upstream = captured.at(-1)!.body;
		expect(upstream.tools).toHaveLength(1);
		expect(upstream.tools[0]).toMatchObject({
			type: "function",
			function: { name: "shell" },
		});
		expect(upstream).not.toHaveProperty("web_search_options");
	});

	test("drops it when it is the only tool", async () => {
		await setup("deepseek");

		const res = await send("/v1/chat/completions", {
			model: "deepseek/deepseek-v4-pro",
			messages: [{ role: "user", content: "say hi" }],
			tools: [CACHED_SEARCH],
		});

		expect(res.status).toBe(200);
		expect(captured.at(-1)!.body).not.toHaveProperty("tools");
	});

	test("still rejects live web search on that model", async () => {
		await setup("deepseek");

		const res = await send("/v1/responses", {
			model: "deepseek/deepseek-v4-pro",
			input: "say hi",
			tools: [functionTool, { type: "web_search" }],
		});

		expect(res.status).toBe(400);
		expect(JSON.stringify(await res.json())).toContain(
			"does not support native web search",
		);
		expect(captured).toHaveLength(0);
	});

	test("forwards it to OpenAI's Responses API", async () => {
		await setup("openai");

		const res = await send("/v1/responses", {
			model: "openai/gpt-5",
			input: "say hi",
			tools: [functionTool, CACHED_SEARCH],
		});

		expect(res.status).toBe(200);
		const { url, body } = captured.at(-1)!;
		expect(url).toMatch(/\/responses$/);
		expect(body.tools).toContainEqual({
			type: "web_search",
			external_web_access: false,
		});
	});
});
