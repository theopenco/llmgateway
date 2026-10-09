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
	}> = [
		{ ttl: "5m" },
		{ ttl: "1h" },
		{ ttl: "1h", client: "5m" },
		{ ttl: "1h", client: "1h" },
		{ ttl: "1h", client: "default" },
		{ ttl: "1h", mode: "passthrough" },
		{ ttl: "1h", mode: "off" },
		{ ttl: "1h", zdr: true },
	];
	for (const endpoint of ["/v1/chat/completions", "/v1/messages"]) {
		test.each(cases)(
			`${endpoint} respects $ttl, client=$client, mode=$mode, zdr=$zdr`,
			async ({ ttl, client, mode = "auto", zdr = false }) => {
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
							...(client && {
								cache_control: {
									type: "ephemeral",
									...(client !== "default" && { ttl: client }),
								},
							}),
						},
					];
					const response = await app.request(endpoint, {
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							Authorization: "Bearer test-cache-token",
							"x-no-fallback": "true",
						},
						body: JSON.stringify({
							model: "anthropic/claude-opus-4-8",
							max_tokens: 64,
							...(endpoint === "/v1/messages"
								? { system, messages: [{ role: "user", content: "Hi" }] }
								: {
										messages: [
											{ role: "system", content: system },
											{ role: "user", content: "Hi" },
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
					if (mode !== "auto") {
						expect(marker).toBeUndefined();
					} else {
						expect(marker).toEqual({
							type: "ephemeral",
							...((client === "1h" ||
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
