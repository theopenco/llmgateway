import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { app } from "@/app.js";
import { clearCache } from "@/test-utils/test-helpers.js";

import { db, eq, tables } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

describe("MCP endpoint", () => {
	async function seedActiveKey() {
		await db
			.insert(tables.user)
			.values({ id: "user-id", name: "user", email: "user" })
			.onConflictDoNothing();
		await db
			.insert(tables.organization)
			.values({
				id: "org-id",
				name: "Test Organization",
				billingEmail: "user",
				plan: "pro",
				retentionLevel: "retain",
				credits: "100.00",
			})
			.onConflictDoNothing();
		await db
			.insert(tables.userOrganization)
			.values({
				id: "user-org-id",
				userId: "user-id",
				organizationId: "org-id",
			})
			.onConflictDoNothing();
		await db
			.insert(tables.project)
			.values({
				id: "project-id",
				name: "Test Project",
				organizationId: "org-id",
				mode: "api-keys",
			})
			.onConflictDoNothing();
		await db
			.insert(tables.apiKey)
			.values({
				id: "token-id",
				...hashApiKeyForStorage("real-token"),
				projectId: "project-id",
				description: "Test API Key",
				createdBy: "user-id",
			})
			.onConflictDoNothing();
	}

	async function reset() {
		await clearCache();
		await db.delete(tables.apiKey);
		await db.delete(tables.userOrganization);
		await db.delete(tables.project);
		await db.delete(tables.organization);
		await db.delete(tables.user);
	}

	beforeEach(reset);
	afterEach(async () => {
		vi.restoreAllMocks();
		await reset();
	});

	const listModelsCall = {
		jsonrpc: "2.0",
		id: 1,
		method: "tools/call",
		params: { name: "list-models", arguments: { limit: 5 } },
	};

	function rpc(method: string, params?: Record<string, unknown>) {
		return app.request("/mcp", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token",
			},
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: "usage-request",
				method,
				params,
			}),
		});
	}

	test("advertises analytics with read-only annotations and output schemas", async () => {
		await seedActiveKey();
		const body = await (await rpc("tools/list")).json();
		for (const name of ["get-account", "get-usage", "get-usage-breakdown"]) {
			expect(body.result.tools).toContainEqual(
				expect.objectContaining({
					name,
					annotations: expect.objectContaining({
						readOnlyHint: true,
						destructiveHint: false,
					}),
					outputSchema: expect.objectContaining({ type: "object" }),
				}),
			);
		}
		expect(body.result.tools).toHaveLength(8);
	});

	test("allows account inspection at the key spending limit and returns structured data", async () => {
		await seedActiveKey();
		await db
			.update(tables.apiKey)
			.set({ usage: "10", usageLimit: "10" })
			.where(eq(tables.apiKey.id, "token-id"));
		const account = {
			user: { id: "user-id", name: "user" },
			organization: {
				id: "org-id",
				name: "Test Organization",
				kind: "default",
			},
			project: { id: "project-id", name: "Test Project" },
			role: "owner",
			usageScope: { type: "project", projectId: "project-id", userId: null },
			apiKey: {
				id: "token-id",
				name: "Test API Key",
				usageUsd: 10,
				usageLimitUsd: 10,
				periodUsageUsd: 0,
				periodUsageLimitUsd: null,
				periodStartedAt: null,
				expiresAt: null,
			},
			creditsBalanceUsd: 100,
		};
		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(Response.json(account));
		const response = await rpc("tools/call", {
			name: "get-account",
			arguments: {},
		});
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.result.structuredContent).toEqual(account);
		expect(JSON.parse(body.result.content[0].text)).toEqual(account);
		expect(fetchSpy).toHaveBeenCalledWith(
			expect.any(URL),
			expect.objectContaining({
				method: "GET",
				headers: expect.objectContaining({
					Authorization: "Bearer real-token",
				}),
			}),
		);
		fetchSpy.mockClear();
		const generation = await (
			await rpc("tools/call", {
				name: "chat",
				arguments: {
					model: "gpt-4o",
					messages: [{ role: "user", content: "hi" }],
				},
			})
		).json();
		expect(generation.result.isError).toBe(true);
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	test("rejects analytics scope overrides and invalid parameters before querying the API", async () => {
		await seedActiveKey();
		const fetchSpy = vi.spyOn(globalThis, "fetch");
		for (const args of [
			{ projectId: "other-project" },
			{ from: "2026-02-30" },
		]) {
			const body = await (
				await rpc("tools/call", { name: "get-usage", arguments: args })
			).json();
			expect(body.result.isError).toBe(true);
		}
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	test("returns an explicit tool error instead of fabricated zero usage on API failure", async () => {
		await seedActiveKey();
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response("private backend details", { status: 503 }),
		);
		const body = await (
			await rpc("tools/call", { name: "get-usage", arguments: {} })
		).json();
		expect(body.result.isError).toBe(true);
		expect(body.result.structuredContent).toBeUndefined();
		expect(body.result.content[0].text).toContain("temporarily unavailable");
		expect(JSON.stringify(body)).not.toContain("private backend details");
	});

	test("rejects expired keys for analytics discovery", async () => {
		await seedActiveKey();
		await db
			.update(tables.apiKey)
			.set({ expiresAt: new Date("2020-01-01") })
			.where(eq(tables.apiKey.id, "token-id"));
		expect((await rpc("tools/list")).status).toBe(401);
	});

	test("preserves client attribution on generation calls", async () => {
		await seedActiveKey();
		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(
				Response.json({ choices: [{ message: { content: "hello" } }] }),
			);
		const response = await app.request("/mcp", {
			method: "POST",
			headers: {
				Authorization: "Bearer real-token",
				"Content-Type": "application/json",
				"x-source": "codex",
				"user-agent": "codex_cli_rs/1.0",
				"x-unrelated": "do-not-forward",
			},
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				method: "tools/call",
				params: {
					name: "chat",
					arguments: {
						model: "gpt-4o",
						messages: [{ role: "user", content: "hi" }],
					},
				},
			}),
		});
		expect((await response.json()).result.content[0].text).toBe("hello");
		expect(fetchSpy).toHaveBeenCalledWith(
			expect.stringContaining("/v1/chat/completions"),
			expect.objectContaining({
				headers: {
					Authorization: "Bearer real-token",
					"Content-Type": "application/json",
					"x-source": "codex",
					"user-agent": "codex_cli_rs/1.0",
				},
			}),
		);
	});

	test("rejects requests without an API key", async () => {
		const res = await app.request("/mcp", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(listModelsCall),
		});

		expect(res.status).toBe(401);
		const json = await res.json();
		expect(json.error.code).toBe(-32001);
	});

	test("rejects an arbitrary unvalidated API key (GHSA-8h26-h6v8-f9cg)", async () => {
		const res = await app.request("/mcp", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer fake-key-any-string",
			},
			body: JSON.stringify(listModelsCall),
		});

		expect(res.status).toBe(401);
		const json = await res.json();
		expect(json.error.code).toBe(-32001);
		expect(JSON.stringify(json)).not.toContain("list-models");
	});

	test("accepts a valid active API key and returns the model catalog", async () => {
		await seedActiveKey();

		const res = await app.request("/mcp", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token",
			},
			body: JSON.stringify(listModelsCall),
		});

		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.error).toBeUndefined();
		expect(json.result).toBeDefined();
	});

	test("rejects an inactive API key", async () => {
		await seedActiveKey();
		await db
			.update(tables.apiKey)
			.set({ status: "inactive" })
			.where(
				eq(
					tables.apiKey.tokenHash,
					hashApiKeyForStorage("real-token").tokenHash,
				),
			);

		const res = await app.request("/mcp", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token",
			},
			body: JSON.stringify(listModelsCall),
		});

		expect(res.status).toBe(401);
		const json = await res.json();
		expect(json.error.code).toBe(-32001);
	});

	test("returns correlated timeouts without logging a server error", async () => {
		await seedActiveKey();

		const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
		const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
		const callToolSpy = vi
			.spyOn(Client.prototype, "callTool")
			.mockRejectedValue(
				new McpError(ErrorCode.RequestTimeout, "Request timed out", {
					timeout: 60_000,
				}),
			);

		try {
			const makeRequest = (id: string | number) => ({
				jsonrpc: "2.0",
				id,
				method: "tools/call",
				params: {
					name: "chat",
					arguments: {
						model: "gpt-4o-mini",
						messages: [{ role: "user", content: "hello" }],
					},
				},
			});
			const request = (body: unknown) =>
				app.request("/mcp", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: "Bearer real-token",
					},
					body: JSON.stringify(body),
				});

			const response = await request(makeRequest(1));
			const json = await response.json();

			expect(response.status).toBe(200);
			expect(json).toMatchObject({
				id: 1,
				error: {
					code: -32001,
					message: "Request timed out",
					data: { timeout: 60_000 },
				},
			});

			const batchResponse = await request([
				makeRequest(2),
				makeRequest("three"),
			]);
			const batchJson = await batchResponse.json();

			expect(batchResponse.status).toBe(200);
			expect(batchJson).toMatchObject([
				{
					id: 2,
					error: {
						code: -32001,
						message: "Request timed out",
					},
				},
				{
					id: "three",
					error: {
						code: -32001,
						message: "Request timed out",
					},
				},
			]);
			expect(warnSpy).toHaveBeenCalledTimes(3);
			expect(warnSpy).toHaveBeenCalledWith("MCP request timeout", {
				message: "MCP error -32001: Request timed out",
				data: { timeout: 60_000 },
			});
			expect(errorSpy).not.toHaveBeenCalled();
		} finally {
			callToolSpy.mockRestore();
			warnSpy.mockRestore();
			errorSpy.mockRestore();
		}
	});
});
