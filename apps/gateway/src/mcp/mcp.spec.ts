import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/app.js";
import { clearCache } from "@/test-utils/test-helpers.js";

import { db, eq, tables } from "@llmgateway/db";

describe("MCP endpoint authentication", () => {
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
				token: "real-token",
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
	afterEach(reset);

	const listModelsCall = {
		jsonrpc: "2.0",
		id: 1,
		method: "tools/call",
		params: { name: "list-models", arguments: { limit: 5 } },
	};

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
			.where(eq(tables.apiKey.token, "real-token"));

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
});
