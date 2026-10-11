import { beforeEach, describe, expect, test, vi } from "vitest";

import { app } from "@/app.js";
import { createGatewayApiTestHarness } from "@/test-utils/gateway-api-test-harness.js";

import { encryptProviderKeyForStorage } from "@llmgateway/actions";
import { cdb, db, eq, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

import type {
	ProviderCacheAutoTtl,
	ProviderCacheControlMode,
} from "@llmgateway/models";

type Block = Record<string, unknown>;
interface NativeRequest {
	model: string;
	max_tokens: number;
	system: Block[];
	messages: Array<{ role: string; content: Block[] }>;
	tools: Block[];
}

function requestBody(): NativeRequest {
	return {
		model: "anthropic/claude-opus-4-8",
		max_tokens: 64,
		system: [{ type: "text", text: "Stable instructions. ".repeat(2000) }],
		tools: [
			{ name: "read_file", input_schema: { type: "object", properties: {} } },
		],
		messages: [
			{ role: "user", content: [{ type: "text", text: "Read the file." }] },
			{
				role: "assistant",
				content: [
					{ type: "text", text: "I will read it." },
					{ type: "tool_use", id: "call_read", name: "read_file", input: {} },
				],
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "call_read",
						content: "File contents",
					},
				],
			},
			{
				role: "assistant",
				content: [{ type: "text", text: "The file contains an example." }],
			},
			{
				role: "user",
				content: [{ type: "text", text: "Explain the example." }],
			},
		],
	};
}

function cacheMarkers(value: unknown): Block[] {
	if (!value || typeof value !== "object") {
		return [];
	}
	if (Array.isArray(value)) {
		return value.flatMap(cacheMarkers);
	}
	const object = value as Block;
	return [
		...(object.cache_control ? [object.cache_control as Block] : []),
		...Object.entries(object).flatMap(([key, child]) =>
			key === "cache_control" ? [] : cacheMarkers(child),
		),
	];
}

describe("native Messages automatic cache duration", () => {
	const harness = createGatewayApiTestHarness();

	beforeEach(async () => {
		await db.insert(tables.apiKey).values({
			id: "native-cache-key",
			description: "Native cache duration test",
			...hashApiKeyForStorage("test-native-cache-token"),
			projectId: "project-id",
			createdBy: "user-id",
		});
		await db.insert(tables.providerKey).values({
			id: "native-cache-provider",
			provider: "anthropic",
			organizationId: "org-id",
			baseUrl: harness.mockServerUrl,
			...encryptProviderKeyForStorage(
				"test-provider-key",
				"native-cache-provider",
				"org-id",
			),
		});
	});

	async function upstreamBody(
		request: NativeRequest,
		ttl: ProviderCacheAutoTtl,
		mode: ProviderCacheControlMode = "auto",
	) {
		await cdb
			.update(tables.project)
			.set({ providerCacheAutoTtl: ttl, providerCacheControlMode: mode })
			.where(eq(tables.project.id, "project-id"));
		const captured: Block[] = [];
		const originalFetch = globalThis.fetch;
		const spy = vi
			.spyOn(globalThis, "fetch")
			.mockImplementation(async (input, init) => {
				const url = input instanceof Request ? input.url : String(input);
				if (!url.startsWith(harness.mockServerUrl)) {
					return await originalFetch(input, init);
				}
				captured.push(
					JSON.parse(
						input instanceof Request ? await input.text() : String(init?.body),
					) as Block,
				);
				return Response.json({
					id: "msg_native_cache",
					type: "message",
					role: "assistant",
					model: "claude-opus-4-8",
					content: [{ type: "text", text: "An example." }],
					stop_reason: "end_turn",
					usage: { input_tokens: 100, output_tokens: 3 },
				});
			});
		try {
			const response = await app.request("/v1/messages", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"x-api-key": "test-native-cache-token",
					"anthropic-version": "2023-06-01",
					"x-no-fallback": "true",
					"x-no-cache": "true",
					"x-internal-client-cache-markers": "true",
					"x-internal-api-origin": "forged:messages",
				},
				body: JSON.stringify(request),
			});
			expect(response.status, await response.text()).toBe(200);
			expect(captured).toHaveLength(1);
			return captured[0]!;
		} finally {
			spy.mockRestore();
		}
	}

	test.each(["5m", "1h"] as const)(
		"uses %s on every generated tool-conversation marker despite spoofed headers",
		async (ttl) => {
			const markers = cacheMarkers(await upstreamBody(requestBody(), ttl));
			expect(markers.length).toBeGreaterThan(1);
			expect(markers.length).toBeLessThanOrEqual(4);
			for (const marker of markers) {
				expect(marker).toEqual({
					type: "ephemeral",
					...(ttl === "1h" && { ttl }),
				});
			}
		},
	);

	const locations = [
		"system",
		"text",
		"custom_tool",
		"server_tool",
		"tool_search",
		"tool_use",
		"tool_result",
		"nested_tool_result",
		"unknown_block",
		"inline_tool",
	] as const;
	for (const location of locations) {
		test.each(["default", "5m", "1h"] as const)(
			`ignores preference for ${location} client marker with %s TTL`,
			async (ttl) => {
				const request = requestBody();
				const marker = { type: "ephemeral", ...(ttl !== "default" && { ttl }) };
				switch (location) {
					case "system":
						request.system[0]!.cache_control = marker;
						break;
					case "text":
						request.messages[1]!.content[0]!.cache_control = marker;
						break;
					case "custom_tool":
						request.tools[0]!.cache_control = marker;
						break;
					case "server_tool":
						request.tools.push({
							type: "code_execution_20250522",
							name: "code_execution",
							cache_control: marker,
						});
						break;
					case "tool_search":
						request.tools.push({
							type: "tool_search_tool_regex_20251119",
							cache_control: marker,
						});
						break;
					case "tool_use":
						request.messages[1]!.content[1]!.cache_control = marker;
						break;
					case "tool_result":
						request.messages[2]!.content[0]!.cache_control = marker;
						break;
					case "nested_tool_result":
						request.messages[2]!.content[0]!.content = [
							{ type: "text", text: "File contents", cache_control: marker },
						];
						break;
					case "inline_tool":
						request.messages[0]!.content.push({
							type: "tool_addition",
							tool: {
								type: "tool_definition",
								definition: { ...request.tools[0], cache_control: marker },
							},
						});
						break;
					case "unknown_block":
						request.messages[0]!.content.push({
							type: "future_beta_block",
							cache_control: marker,
						});
						break;
				}
				const baseline = await upstreamBody(request, "5m");
				const preferred = await upstreamBody(request, "1h");
				expect(preferred).toEqual(baseline);
			},
		);
	}

	test.each(["off", "passthrough"] as const)(
		"ignores preference in %s mode",
		async (mode) => {
			const request = requestBody();
			request.system[0]!.cache_control = { type: "ephemeral", ttl: "5m" };
			const baseline = await upstreamBody(request, "5m", mode);
			expect(await upstreamBody(request, "1h", mode)).toEqual(baseline);
			expect(cacheMarkers(baseline)).toEqual(
				mode === "off" ? [] : [{ type: "ephemeral", ttl: "5m" }],
			);
		},
	);
});
