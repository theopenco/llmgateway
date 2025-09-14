import { expect, test, beforeEach, describe, afterEach } from "vitest";

import { createTestUser, deleteAll } from "@/testing";

import { db, tables } from "@llmgateway/db";

import { app } from "..";

describe("provider keys route", () => {
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
			plan: "pro",
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

		// Create test provider key
		await db.insert(tables.providerKey).values({
			id: "test-provider-key-id",
			token: "test-provider-token",
			provider: "openai",
			organizationId: "test-org-id",
		});
	});

	test("GET /keys/provider unauthorized", async () => {
		const res = await app.request("/keys/provider");
		expect(res.status).toBe(401);
	});

	test("POST /keys/provider unauthorized", async () => {
		const res = await app.request("/keys/provider", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				provider: "openai",
			}),
		});
		expect(res.status).toBe(401);
	});

	test("DELETE /keys/provider/test-provider-key-id unauthorized", async () => {
		const res = await app.request("/keys/provider/test-provider-key-id", {
			method: "DELETE",
		});
		expect(res.status).toBe(401);
	});

	test("PATCH /keys/provider/test-provider-key-id unauthorized", async () => {
		const res = await app.request("/keys/provider/test-provider-key-id", {
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

	test("GET /keys/provider", async () => {
		const res = await app.request("/keys/provider", {
			headers: {
				Cookie: token,
			},
		});
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json).toHaveProperty("providerKeys");
		expect(json.providerKeys.length).toBe(1);
		expect(json.providerKeys[0].provider).toBe("openai");
	});

	test("POST /keys/provider", async () => {
		const res = await app.request("/keys/provider", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Cookie: token,
			},
			body: JSON.stringify({
				provider: "inference.net",
				token: "inference-test-token",
				organizationId: "test-org-id",
			}),
		});
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json).toHaveProperty("providerKey");
		expect(json.providerKey.provider).toBe("inference.net");
		expect(json.providerKey.token).toBe("inference-test-token");

		// Verify the key was created in the database
		const providerKey = await db.query.providerKey.findFirst({
			where: {
				provider: {
					eq: "inference.net",
				},
			},
		});
		expect(providerKey).not.toBeNull();
		expect(providerKey?.provider).toBe("inference.net");
	});

	test("POST /keys/provider with invalid provider", async () => {
		const res = await app.request("/keys/provider", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Cookie: token,
			},
			body: JSON.stringify({
				provider: "invalid-provider",
				organizationId: "test-org-id",
			}),
		});
		expect(res.status).toBe(400);
	});

	test("POST /keys/provider with duplicate provider", async () => {
		const res = await app.request("/keys/provider", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Cookie: token,
			},
			body: JSON.stringify({
				provider: "openai",
				organizationId: "test-org-id",
			}),
		});
		expect(res.status).toBe(400);
	});

	test("PATCH /keys/provider/{id}", async () => {
		const res = await app.request("/keys/provider/test-provider-key-id", {
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
		expect(json).toHaveProperty("providerKey");
		expect(json.providerKey.status).toBe("inactive");

		// Verify the key was updated in the database
		const providerKey = await db.query.providerKey.findFirst({
			where: {
				id: {
					eq: "test-provider-key-id",
				},
			},
		});
		expect(providerKey).not.toBeNull();
		expect(providerKey?.status).toBe("inactive");
	});

	test("DELETE /keys/provider/{id}", async () => {
		const res = await app.request("/keys/provider/test-provider-key-id", {
			method: "DELETE",
			headers: {
				Cookie: token,
			},
		});
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json).toHaveProperty("message");
		expect(json.message).toBe("Provider key deleted successfully");

		// Verify the key was soft-deleted in the database
		const providerKey = await db.query.providerKey.findFirst({
			where: {
				id: {
					eq: "test-provider-key-id",
				},
			},
		});
		expect(providerKey).not.toBeNull();
		expect(providerKey?.status).toBe("deleted");
	});
});
