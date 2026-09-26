import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { encryptProviderKeyForStorage } from "@llmgateway/actions";
import * as cache from "@llmgateway/cache";
import { db, eq, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

import { app } from "./app.js";
import { createGatewayApiTestHarness } from "./test-utils/gateway-api-test-harness.js";

const completion = {
	id: "chatcmpl-options",
	object: "chat.completion",
	created: 1,
	model: "gpt-5",
	choices: [
		{
			index: 0,
			message: { role: "assistant", content: "Hello" },
			finish_reason: "stop",
		},
	],
	usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
};

describe("response options and Anthropic compatibility", () => {
	createGatewayApiTestHarness();
	beforeEach(async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id",
			...hashApiKeyForStorage("test-token"),
			projectId: "project-id",
			createdBy: "user-id",
			description: "Test key",
		});
		for (const provider of ["openai", "anthropic"]) {
			await db.insert(tables.providerKey).values({
				id: `options-${provider}`,
				provider,
				organizationId: "org-id",
				...encryptProviderKeyForStorage(
					"test-key",
					`options-${provider}`,
					"org-id",
				),
			});
		}
	});
	afterEach(() => {
		vi.restoreAllMocks();
	});

	function request(
		body: Record<string, unknown>,
		path = "/v1/chat/completions",
	) {
		return app.request(path, {
			method: "POST",
			headers: {
				Authorization: "Bearer test-token",
				"Content-Type": "application/json",
				"x-no-fallback": "true",
			},
			body: JSON.stringify(body),
		});
	}

	test.each([
		[{ verbosity: "low" }, { verbosity: "high" }],
		[{ plugins: [] }, { plugins: [{ id: "response-healing" }] }],
		[{ image_config: { seed: 1 } }, { image_config: { seed: 2 } }],
	])("separates response cache options %j", async (first, second) => {
		vi.spyOn(cache, "setCache").mockImplementation(async (key, value, ttl) => {
			await cache.storageRedisClient.set(key, JSON.stringify(value), "EX", ttl);
		});
		await db
			.update(tables.project)
			.set({ cachingEnabled: true })
			.where(eq(tables.project.id, "project-id"));
		const upstream = vi.spyOn(globalThis, "fetch").mockImplementation(
			async () =>
				new Response(JSON.stringify(completion), {
					headers: { "Content-Type": "application/json" },
				}),
		);
		for (const options of [first, first, second]) {
			const response = await request({
				model: "openai/gpt-5",
				messages: [{ role: "user", content: "Hello" }],
				...options,
			});
			expect(response.status, await response.text()).toBe(200);
		}
		expect(upstream).toHaveBeenCalledTimes(2);
	});

	test("publishes effort support through model capability metadata", async () => {
		const response = await app.request("/openapi.json");
		expect(response.status).toBe(200);
		const spec = await response.text();
		expect(spec).toContain("supported_parameters");
		expect(spec).not.toContain("currently only claude-opus-4-5-20251101");
	});

	test.each([false, true])(
		"forwards effort without its retired beta (stream=%s)",
		async (stream) => {
			let headers = new Headers();
			let body: Record<string, unknown> = {};
			vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
				headers = new Headers(init?.headers);
				body = JSON.parse(String(init?.body)) as Record<string, unknown>;
				const message = {
					id: "msg-options",
					type: "message",
					role: "assistant",
					model: "claude-opus-4-7",
					content: [{ type: "text", text: "Hello" }],
					stop_reason: "end_turn",
					usage: { input_tokens: 1, output_tokens: 1 },
				};
				if (!stream) {
					return new Response(JSON.stringify(message), {
						headers: { "Content-Type": "application/json" },
					});
				}
				return new Response(
					[
						{ type: "message_start", message: { ...message, content: [] } },
						{
							type: "content_block_start",
							index: 0,
							content_block: { type: "text", text: "" },
						},
						{
							type: "content_block_delta",
							index: 0,
							delta: { type: "text_delta", text: "Hello" },
						},
						{ type: "content_block_stop", index: 0 },
						{
							type: "message_delta",
							delta: { stop_reason: "end_turn" },
							usage: { output_tokens: 1 },
						},
						{ type: "message_stop" },
					]
						.map(
							(event) =>
								`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
						)
						.join(""),
					{ headers: { "Content-Type": "text/event-stream" } },
				);
			});
			const response = await request({
				model: "anthropic/claude-opus-4-7",
				messages: [{ role: "user", content: "Hello" }],
				effort: "medium",
				stream,
			});
			expect(response.status, await response.text()).toBe(200);
			expect(body.output_config).toMatchObject({ effort: "medium" });
			expect(headers.get("anthropic-beta") ?? "").not.toContain(
				"effort-2025-11-24",
			);
		},
	);

	test("delays an Anthropic tool block until its name arrives", async () => {
		const deltas = [
			{
				tool_calls: [
					{
						index: 0,
						id: "call-options",
						type: "function",
						function: { arguments: "" },
					},
				],
			},
			{
				tool_calls: [{ index: 0, function: { name: "lookup", arguments: "" } }],
			},
			{
				tool_calls: [{ index: 0, function: { arguments: '{"city":"Lund"}' } }],
			},
		];
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(
				[
					...deltas.map((delta) => ({
						...completion,
						choices: [{ index: 0, delta, finish_reason: null }],
					})),
					{
						...completion,
						choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
					},
				]
					.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
					.join("") + "data: [DONE]\n\n",
				{ headers: { "Content-Type": "text/event-stream" } },
			),
		);
		const response = await request(
			{
				model: "openai/gpt-4o-mini",
				max_tokens: 100,
				stream: true,
				messages: [{ role: "user", content: "Look up Lund" }],
				tools: [
					{
						name: "lookup",
						input_schema: {
							type: "object",
							properties: { city: { type: "string" } },
						},
					},
				],
			},
			"/v1/messages",
		);
		const text = await response.text();
		expect(response.status, text).toBe(200);
		const events = text
			.split("\n")
			.filter((line) => line.startsWith("data: {"))
			.map(
				(line) =>
					JSON.parse(line.slice(6)) as {
						type: string;
						content_block?: { type: string; name?: string };
						delta?: { partial_json?: string };
					},
			);
		expect(
			events.find((event) => event.content_block?.type === "tool_use")
				?.content_block?.name,
		).toBe("lookup");
		expect(
			events.map((event) => event.delta?.partial_json ?? "").join(""),
		).toBe('{"city":"Lund"}');
	});

	test.each(["openai/gpt-4o-mini", "anthropic/claude-opus-4-7"])(
		"forwards tool-result images to %s",
		async (model) => {
			let body: {
				messages?: { role: string; content: unknown; tool_call_id?: string }[];
			} = {};
			vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
				body = JSON.parse(String(init?.body)) as typeof body;
				return new Response(
					JSON.stringify(
						model.startsWith("anthropic")
							? {
									id: "msg-image",
									type: "message",
									role: "assistant",
									model: "claude-opus-4-7",
									content: [{ type: "text", text: "Hello" }],
									stop_reason: "end_turn",
									usage: { input_tokens: 1, output_tokens: 1 },
								}
							: completion,
					),
					{ headers: { "Content-Type": "application/json" } },
				);
			});
			const response = await request(
				{
					model,
					max_tokens: 100,
					messages: [
						{ role: "user", content: "Inspect this" },
						{
							role: "assistant",
							content: [
								{
									type: "tool_use",
									id: "call-image",
									name: "inspect",
									input: {},
								},
							],
						},
						{
							role: "user",
							content: [
								{
									type: "tool_result",
									tool_use_id: "call-image",
									content: [
										{ type: "text", text: "Result image" },
										{
											type: "image",
											source: {
												type: "base64",
												media_type: "image/png",
												data: "aGVsbG8=",
											},
										},
									],
								},
							],
						},
					],
				},
				"/v1/messages",
			);
			expect(response.status, await response.text()).toBe(200);
			if (model.startsWith("anthropic")) {
				expect(body.messages?.at(-1)).toMatchObject({
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "call-image",
							content: [
								{ type: "text", text: "Result image" },
								{
									type: "image",
									source: {
										type: "base64",
										media_type: "image/png",
										data: "aGVsbG8=",
									},
								},
							],
						},
					],
				});
				return;
			}
			expect(
				body.messages?.find((message) => message.role === "tool"),
			).toMatchObject({
				tool_call_id: "call-image",
				content: [{ type: "text", text: "Result image" }],
			});
			expect(body.messages?.at(-1)).toMatchObject({
				role: "user",
				content: [
					{ type: "text", text: "Images from tool result call-image:" },
					{
						type: "image_url",
						image_url: { url: "data:image/png;base64,aGVsbG8=" },
					},
				],
			});
		},
	);
});
