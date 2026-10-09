import { afterEach, describe, expect, test, vi } from "vitest";

import { encryptProviderKeyForStorage } from "@llmgateway/actions";
import { cdb, db, eq, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

import { app } from "./app.js";
import { createGatewayApiTestHarness } from "./test-utils/gateway-api-test-harness.js";

import type {
	BaseMessage,
	OpenAIToolInput,
	OpenAIFunctionToolInput,
	ProviderCacheAutoTtl,
} from "@llmgateway/models";

function markers(body: unknown): Array<{ ttl?: string }> {
	if (Array.isArray(body)) {
		return body.flatMap(markers);
	}
	if (body && typeof body === "object") {
		return Object.entries(body).flatMap(([key, value]) =>
			key === "cache_control" || key === "cachePoint"
				? [value as { ttl?: string }]
				: markers(value),
		);
	}
	return [];
}

function conversation(): BaseMessage[] {
	return [
		{ role: "system", content: "Stable instructions. ".repeat(2000) },
		{ role: "user", content: "Read the file." },
		{
			role: "assistant",
			content: "I will read it.",
			tool_calls: [
				{
					id: "call_read",
					type: "function",
					function: { name: "read_file", arguments: "{}" },
				},
			],
		},
		{ role: "tool", tool_call_id: "call_read", content: "File contents" },
		{ role: "assistant", content: "Here is the file." },
		{ role: "user", content: "Now explain it." },
	];
}

const readTool: OpenAIFunctionToolInput = {
	type: "function",
	function: {
		name: "read_file",
		parameters: { type: "object", properties: {} },
	},
};

describe("chat completions cache duration across provider attempts", () => {
	const harness = createGatewayApiTestHarness();
	afterEach(() => vi.restoreAllMocks());

	async function setup(ttl: ProviderCacheAutoTtl) {
		await cdb
			.update(tables.project)
			.set({ providerCacheAutoTtl: ttl })
			.where(eq(tables.project.id, "project-id"));
		await db.insert(tables.apiKey).values({
			id: "cache-chat-key",
			description: "Cache chat test",
			...hashApiKeyForStorage("test-cache-chat"),
			projectId: "project-id",
			createdBy: "user-id",
		});
	}

	async function addProvider(provider: string, suffix = provider) {
		const id = `cache-chat-${suffix}`;
		await db.insert(tables.providerKey).values({
			id,
			provider,
			organizationId: "org-id",
			baseUrl: `${harness.mockServerUrl}/${suffix}`,
			...encryptProviderKeyForStorage(`test-provider-${suffix}`, id, "org-id"),
		});
	}

	function capture(failFirst = false, stream = false) {
		const bodies: Array<{ url: string; body: unknown }> = [];
		const originalFetch = globalThis.fetch;
		vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
			const url = input instanceof Request ? input.url : String(input);
			if (!url.startsWith(harness.mockServerUrl)) {
				return await originalFetch(input, init);
			}
			bodies.push({
				url,
				body: JSON.parse(
					input instanceof Request ? await input.text() : String(init?.body),
				),
			});
			if (failFirst && bodies.length === 1) {
				return Response.json(
					{
						error: { type: "api_error", message: "Temporary upstream failure" },
					},
					{ status: 500 },
				);
			}
			if (stream) {
				const events = [
					{
						type: "message_start",
						message: {
							id: "msg_cache_chat",
							type: "message",
							role: "assistant",
							model: "claude-opus-4-8",
							content: [],
							usage: { input_tokens: 100, output_tokens: 0 },
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
						delta: { type: "text_delta", text: "Hello" },
					},
					{ type: "content_block_stop", index: 0 },
					{
						type: "message_delta",
						delta: { stop_reason: "end_turn", stop_sequence: null },
						usage: { output_tokens: 1 },
					},
					{ type: "message_stop" },
				];
				return new Response(
					events
						.map(
							(event) =>
								`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
						)
						.join(""),
					{ headers: { "Content-Type": "text/event-stream" } },
				);
			}
			return Response.json({
				id: "msg_cache_chat",
				type: "message",
				role: "assistant",
				model: "claude-opus-4-8",
				content: [{ type: "text", text: "Hello" }],
				stop_reason: "end_turn",
				usage: { input_tokens: 100, output_tokens: 1 },
			});
		});
		return bodies;
	}

	async function request(
		messages: BaseMessage[],
		tools: OpenAIToolInput[] = [readTool],
		model = "anthropic/claude-opus-4-8",
		stream = false,
	) {
		const response = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer test-cache-chat",
			},
			body: JSON.stringify({ model, max_tokens: 64, messages, tools, stream }),
		});
		const body = await response.text();
		expect(response.status, body).toBe(200);
		if (stream) {
			expect(body).toContain("Hello");
			expect(body).toContain("[DONE]");
		}
	}

	test.each(["5m", "1h"] as const)(
		"applies %s to system and both conversation boundaries",
		async (ttl) => {
			await setup(ttl);
			await addProvider("anthropic");
			const bodies = capture();
			await request(conversation());
			expect(bodies).toHaveLength(1);
			const outgoing = markers(bodies[0].body);
			expect(outgoing).toHaveLength(3);
			expect(
				outgoing.every(
					(marker) => marker.ttl === (ttl === "1h" ? "1h" : undefined),
				),
			).toBe(true);
		},
	);

	for (const placement of [
		"system",
		"message",
		"tool",
		"tool-result",
	] as const) {
		test.each(["default", "5m", "1h"] as const)(
			`preserves client %s markers on ${placement} regardless of preference`,
			async (ttl) => {
				await setup("5m");
				await addProvider("anthropic");
				const bodies = capture();
				const messages = conversation();
				const tools = [structuredClone(readTool)];
				const marker = {
					type: "ephemeral" as const,
					...(ttl !== "default" && { ttl }),
				};
				if (placement === "tool") {
					tools[0].cache_control = marker;
				} else if (placement === "tool-result") {
					messages[3].tool_result_cache_control = marker;
				} else {
					const index = placement === "system" ? 0 : 4;
					messages[index].content = [
						{
							type: "text",
							text: String(messages[index].content),
							cache_control: marker,
						},
					];
				}
				await request(messages, tools);
				await cdb
					.update(tables.project)
					.set({ providerCacheAutoTtl: "1h" })
					.where(eq(tables.project.id, "project-id"));
				await request(messages, tools);
				expect(bodies).toHaveLength(2);
				expect(bodies[1].body).toEqual(bodies[0].body);
				expect(markers(bodies[1].body)).toContainEqual(marker);
			},
		);
	}

	for (const kind of ["retry", "fallback"] as const) {
		test.each([undefined, "default", "5m", "1h"] as const)(
			`preserves cache policy through ${kind} with client TTL %s`,
			async (clientTtl) => {
				await setup("1h");
				await addProvider("anthropic");
				await addProvider(
					kind === "retry" ? "anthropic" : "azure-anthropic",
					"second",
				);
				const bodies = capture(true);
				const tools = [structuredClone(readTool)];
				if (clientTtl) {
					tools[0].cache_control = {
						type: "ephemeral",
						...(clientTtl !== "default" && { ttl: clientTtl }),
					};
				}
				await request(
					conversation(),
					tools,
					kind === "retry" ? "anthropic/claude-opus-4-8" : "claude-opus-4-8",
				);
				expect(bodies).toHaveLength(2);
				const firstMarkers = markers(bodies[0].body);
				expect(firstMarkers).toHaveLength(clientTtl ? 4 : 3);
				expect(markers(bodies[1].body)).toEqual(firstMarkers);
				if (clientTtl) {
					expect(firstMarkers).toContainEqual(tools[0].cache_control);
					expect(
						firstMarkers.filter((marker) => marker.ttl === "1h"),
					).toHaveLength(clientTtl === "1h" ? 1 : 0);
				} else {
					expect(firstMarkers.every((marker) => marker.ttl === "1h")).toBe(
						true,
					);
				}
				expect(bodies[0].url).not.toBe(bodies[1].url);
			},
		);
	}

	test.each(["5m", "1h"] as const)(
		"streams a tool conversation using %s markers",
		async (ttl) => {
			await setup(ttl);
			await addProvider("anthropic");
			const bodies = capture(false, true);
			await request(
				conversation(),
				[readTool],
				"anthropic/claude-opus-4-8",
				true,
			);
			expect(bodies).toHaveLength(1);
			const outgoing = markers(bodies[0].body);
			expect(outgoing).toHaveLength(3);
			expect(
				outgoing.every(
					(marker) => marker.ttl === (ttl === "1h" ? "1h" : undefined),
				),
			).toBe(true);
		},
	);
});
