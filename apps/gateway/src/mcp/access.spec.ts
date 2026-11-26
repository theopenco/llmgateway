import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { mcpHandler } from "./mcp.js";

const mocks = vi.hoisted(() => ({ access: vi.fn() }));
vi.mock("@/lib/cached-queries.js", () => ({
	findApiKeyByToken: vi.fn(async (token: string) => ({
		id: token,
		keyType: "user",
		status: "active",
		expiresAt: null,
		projectId: "project",
		createdBy: "user",
	})),
	findProjectById: vi.fn(async () => ({ organizationId: "org" })),
	findOrganizationById: vi.fn(async () => ({
		id: "org",
		retentionLevel: "retain",
	})),
}));
vi.mock("@/models/model-access.js", () => ({ getModelsAccess: mocks.access }));
vi.mock("@/lib/api-key-usage-limits.js", () => ({
	assertApiKeyWithinUsageLimits: vi.fn(),
	assertMemberProjectAccess: vi.fn(),
	assertMemberWithinBudget: vi.fn(),
}));

function server() {
	const app = new Hono();
	app.all("/mcp", mcpHandler);
	return app;
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

describe("MCP metadata and legacy session access", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.access.mockResolvedValue({
			apiKey: { id: "key" },
			organization: { id: "org" },
			clientIp: "198.51.100.1",
			iamRules: { team: [], member: [], key: [] },
		});
	});
	afterEach(() => vi.restoreAllMocks());

	test.each(["key", "member", "team"])(
		"%s IP rules block analytics before any backend request",
		async (scope) => {
			const access = await mocks.access();
			access.iamRules[scope] = [
				{
					id: "ip-rule",
					status: "active",
					ruleType: "allow_ip_cidrs",
					ruleValue: { ipCidrs: ["192.0.2.0/24"] },
				},
			];
			const fetch = vi.spyOn(globalThis, "fetch");
			for (const name of ["get-account", "get-usage", "get-usage-breakdown"]) {
				const response = await server().request("/mcp", {
					method: "POST",
					headers: { ...bearer("fixture"), "Content-Type": "application/json" },
					body: JSON.stringify({
						jsonrpc: "2.0",
						id: 1,
						method: "tools/call",
						params: { name, arguments: {} },
					}),
				});
				expect(response.status).toBe(403);
			}
			expect(fetch).not.toHaveBeenCalled();
		},
	);

	test("one key cannot terminate another key's legacy SSE session", async () => {
		const app = server();
		const stream = await app.request("/mcp", {
			headers: { ...bearer("owner"), Accept: "text/event-stream" },
		});
		expect(stream.status).toBe(200);
		const sessionId = stream.headers.get("mcp-session-id")!;
		try {
			const denied = await app.request("/mcp", {
				method: "DELETE",
				headers: { ...bearer("other"), "mcp-session-id": sessionId },
			});
			expect(denied.status).toBe(403);
			const allowed = await app.request("/mcp", {
				method: "DELETE",
				headers: { ...bearer("owner"), "mcp-session-id": sessionId },
			});
			expect(allowed.status).toBe(204);
		} finally {
			await stream.body?.cancel();
		}
	});

	test("public discovery remains unauthenticated", async () => {
		const response = await server().request("/mcp");
		expect(response.status).toBe(200);
		expect(mocks.access).not.toHaveBeenCalled();
	});
});
