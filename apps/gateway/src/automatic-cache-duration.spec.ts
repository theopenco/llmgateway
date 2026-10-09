import { describe, expect, test, vi } from "vitest";

import { encryptProviderKeyForStorage } from "@llmgateway/actions";
import { cdb, db, eq, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

import { app } from "./app.js";
import { createGatewayApiTestHarness } from "./test-utils/gateway-api-test-harness.js";

import type {
	ProviderCacheAutoTtl,
	ProviderCacheControlMode,
} from "@llmgateway/models";

describe("automatic cache duration through the gateway", () => {
	const harness = createGatewayApiTestHarness();
	const cases: Array<{
		ttl: ProviderCacheAutoTtl;
		client?: "5m" | "1h" | "default";
		mode?: ProviderCacheControlMode;
		zdr?: boolean;
		toolTurn?: boolean;
		nativeMarker?: "server_tool" | "tool_use";
	}> = [
		{ ttl: "5m" },
		{ ttl: "1h" },
		{ ttl: "1h", client: "5m" },
		{ ttl: "1h", client: "1h" },
		{ ttl: "1h", client: "default" },
		{ ttl: "1h", mode: "passthrough" },
		{ ttl: "1h", mode: "off" },
		{ ttl: "1h", zdr: true },
		{ ttl: "1h", client: "5m", toolTurn: true },
		{ ttl: "1h", client: "1h", toolTurn: true },
		{ ttl: "1h", client: "default", toolTurn: true },
	];
	for (const endpoint of ["/v1/chat/completions", "/v1/messages"]) {
		const endpointCases: typeof cases = [...cases];
		if (endpoint === "/v1/messages") {
			for (const client of ["5m", "1h", "default"] as const) {
				endpointCases.push(
					{ ttl: "1h", client, nativeMarker: "server_tool" },
					{ ttl: "1h", client, toolTurn: true, nativeMarker: "tool_use" },
				);
			}
		}
		test.each(endpointCases)(
			`${endpoint} respects $ttl, client=$client, mode=$mode, zdr=$zdr, toolTurn=$toolTurn, nativeMarker=$nativeMarker`,
			async ({
				ttl,
				client,
				mode = "auto",
				zdr = false,
				toolTurn = false,
				nativeMarker,
			}) => {
				await cdb
					.update(tables.project)
					.set({ providerCacheAutoTtl: ttl, providerCacheControlMode: mode })
					.where(eq(tables.project.id, "project-id"));
				if (zdr) {
					await cdb
						.update(tables.organization)
						.set({
							providerCompliancePolicy: {
								enabled: true,
								zeroDataRetention: true,
							},
						})
						.where(eq(tables.organization.id, "org-id"));
				}
				await db.insert(tables.apiKey).values({
					id: "cache-test-key",
					description: "Cache duration test",
					...hashApiKeyForStorage("test-cache-token"),
					projectId: "project-id",
					createdBy: "user-id",
				});
				await db.insert(tables.providerKey).values({
					id: "cache-provider-key",
					provider: "anthropic",
					organizationId: "org-id",
					baseUrl: harness.mockServerUrl,
					...encryptProviderKeyForStorage(
						"test-provider-key",
						"cache-provider-key",
						"org-id",
					),
				});
				const bodies: Array<{
					system: Array<{ cache_control?: { type: string; ttl?: string } }>;
				}> = [];
				const originalFetch = globalThis.fetch;
				const spy = vi
					.spyOn(globalThis, "fetch")
					.mockImplementation(async (input, init) => {
						const url = input instanceof Request ? input.url : String(input);
						if (url.startsWith(harness.mockServerUrl)) {
							bodies.push(
								JSON.parse(
									input instanceof Request
										? await input.text()
										: String(init?.body),
								),
							);
							return Response.json({
								id: "msg_cache_duration",
								type: "message",
								role: "assistant",
								model: "claude-opus-4-8",
								content: [{ type: "text", text: "Hello" }],
								stop_reason: "end_turn",
								usage: { input_tokens: 100, output_tokens: 1 },
							});
						}
						return await originalFetch(input, init);
					});
				try {
					const system = [
						{
							type: "text",
							text: "Stable instructions. ".repeat(2000),
							...(client &&
								!toolTurn &&
								!nativeMarker && {
									cache_control: {
										type: "ephemeral",
										...(client !== "default" && { ttl: client }),
									},
								}),
						},
					];
					const markedText = {
						type: "text",
						text: "I will read the file.",
						cache_control: {
							type: "ephemeral",
							...(client !== "default" && { ttl: client }),
						},
					};
					const conversation = [
						{ role: "user", content: "Hi" },
						...(toolTurn
							? endpoint === "/v1/messages"
								? [
										{
											role: "assistant",
											content: [
												nativeMarker
													? { type: "text", text: markedText.text }
													: markedText,
												{
													type: "tool_use",
													id: "call_read",
													name: "read_file",
													input: {},
													...(nativeMarker === "tool_use" && {
														cache_control: markedText.cache_control,
													}),
												},
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
									]
								: [
										{
											role: "assistant",
											content: [markedText],
											tool_calls: [
												{
													id: "call_read",
													type: "function",
													function: { name: "read_file", arguments: "{}" },
												},
											],
										},
										{
											role: "tool",
											tool_call_id: "call_read",
											content: "File contents",
										},
									]
							: []),
					];
					const response = await app.request(endpoint, {
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							Authorization: "Bearer test-cache-token",
							"x-no-fallback": "true",
							"x-internal-client-cache-markers": "true",
						},
						body: JSON.stringify({
							model: "anthropic/claude-opus-4-8",
							max_tokens: 64,
							...(nativeMarker === "server_tool" && {
								tools: [
									{
										type: "code_execution_20250522",
										name: "code_execution",
										cache_control: markedText.cache_control,
									},
								],
							}),
							...(endpoint === "/v1/messages"
								? { system, messages: conversation }
								: {
										messages: [
											{ role: "system", content: system },
											...conversation,
										],
									}),
						}),
					});
					if (zdr) {
						expect(response.status).toBe(403);
						expect(bodies).toHaveLength(0);
						return;
					}
					expect(response.status, await response.text()).toBe(200);
					expect(bodies).toHaveLength(1);
					const marker = bodies[0]!.system[0]!.cache_control;
					if (
						mode !== "auto" ||
						(toolTurn && endpoint === "/v1/chat/completions" && client === "1h")
					) {
						expect(marker).toBeUndefined();
					} else {
						expect(marker).toEqual({
							type: "ephemeral",
							...(!toolTurn &&
								!nativeMarker &&
								(client === "1h" ||
									client === "5m" ||
									(!client && ttl === "1h")) && { ttl: client ?? ttl }),
						});
					}
				} finally {
					spy.mockRestore();
				}
			},
		);
	}
});
