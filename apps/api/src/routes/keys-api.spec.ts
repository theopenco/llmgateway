import { expect, test, beforeEach, describe, afterEach } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, tables, eq } from "@llmgateway/db";

describe("keys route", () => {
	let token: string;

	afterEach(async () => {
		await deleteAll();
	});

	beforeEach(async () => {
		token = await createTestUser();

		// Create test organization
		await db.insert(tables.organization).values({
			id: "test-org-id",
			name: "Test Organization",
		});

		// Associate user with organization
		await db.insert(tables.userOrganization).values({
			id: "test-user-org-id",
			userId: "test-user-id",
			organizationId: "test-org-id",
		});

		// Create test project
		await db.insert(tables.project).values({
			id: "test-project-id",
			name: "Test Project",
			organizationId: "test-org-id",
		});

		// Create test API key
		await db.insert(tables.apiKey).values({
			id: "test-api-key-id",
			token: "test-token",
			projectId: "test-project-id",
			description: "Test API Key",
			createdBy: "test-user-id",
		});
	});

	test("GET /keys/api unauthorized", async () => {
		const res = await app.request("/keys/api");
		expect(res.status).toBe(401);
	});

	test("POST /keys/api unauthorized", async () => {
		const res = await app.request("/keys/api", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				description: "New API Key",
			}),
		});
		expect(res.status).toBe(401);
	});

	test("DELETE /keys/api/test-api-key-id unauthorized", async () => {
		const res = await app.request("/keys/api/test-api-key-id", {
			method: "DELETE",
		});
		expect(res.status).toBe(401);
	});

	test("PATCH /keys/api/test-api-key-id unauthorized", async () => {
		const res = await app.request("/keys/api/test-api-key-id", {
			method: "PATCH",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				status: "inactive",
			}),
		});
		expect(res.status).toBe(401);
	});

	test("GET /keys/api", async () => {
		const res = await app.request("/keys/api", {
			headers: {
				Cookie: token,
			},
		});
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json).toHaveProperty("apiKeys");
		expect(json.apiKeys.length).toBe(2);
		expect(json.apiKeys[1].description).toBe("Test API Key");
	});

	test("PATCH /keys/api/{id}", async () => {
		const res = await app.request("/keys/api/test-api-key-id", {
			method: "PATCH",
			headers: {
				"Content-Type": "application/json",
				Cookie: token,
			},
			body: JSON.stringify({
				status: "inactive",
			}),
		});
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json).toHaveProperty("message");
		expect(json).toHaveProperty("apiKey");
		expect(json.apiKey.status).toBe("inactive");

		// Verify the key was updated in the database
		const apiKey = await db.query.apiKey.findFirst({
			where: {
				id: {
					eq: "test-api-key-id",
				},
			},
		});
		expect(apiKey).not.toBeNull();
		expect(apiKey?.status).toBe("inactive");
	});

	test("POST /keys/api should enforce plan limits", async () => {
		// Create 4 more API keys to reach the free plan limit of 5
		for (let i = 2; i <= 5; i++) {
			await db.insert(tables.apiKey).values({
				id: `test-api-key-id-${i}`,
				token: `test-token-${i}`,
				projectId: "test-project-id",
				description: `Test API Key ${i}`,
				status: "active",
				createdBy: "test-user-id",
			});
		}

		// Try to create the 6th API key, should fail for free plan
		const res = await app.request("/keys/api", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Cookie: token,
			},
			body: JSON.stringify({
				description: "Sixth API Key",
				projectId: "test-project-id",
				usageLimit: null,
			}),
		});

		expect(res.status).toBe(400);
		const json = await res.json();
		expect(json.message).toContain("API key limit reached");
		expect(json.message).toContain("Free plan allows maximum 5 API keys");
	});

	test("POST /keys/api should allow more keys for pro plan", async () => {
		// Update organization to pro plan
		await db
			.update(tables.organization)
			.set({ plan: "pro" })
			.where(eq(tables.organization.id, "test-org-id"));

		// Create 19 more API keys to reach 20 total (pro plan limit)
		for (let i = 2; i <= 20; i++) {
			await db.insert(tables.apiKey).values({
				id: `test-api-key-id-${i}`,
				token: `test-token-${i}`,
				projectId: "test-project-id",
				description: `Test API Key ${i}`,
				status: "active",
				createdBy: "test-user-id",
			});
		}

		// Try to create the 21st API key, should fail even for pro plan
		const res = await app.request("/keys/api", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Cookie: token,
			},
			body: JSON.stringify({
				description: "Twenty-first API Key",
				projectId: "test-project-id",
				usageLimit: null,
			}),
		});

		expect(res.status).toBe(400);
		const json = await res.json();
		expect(json.message).toContain("API key limit reached");
		expect(json.message).toContain("Pro plan allows maximum 20 API keys");
	});
});
