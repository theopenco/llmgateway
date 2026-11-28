import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, eq, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

describe("keys route lifecycle", () => {
	let token: string;

	afterEach(async () => {
		await deleteAll();
	});

	beforeEach(async () => {
		token = await createTestUser();

		await db.insert(tables.organization).values({
			id: "test-org-id",
			name: "Test Organization",
			billingEmail: "test@example.com",
		});
		await db.insert(tables.userOrganization).values({
			id: "test-user-org-id",
			userId: "test-user-id",
			organizationId: "test-org-id",
		});
		await db.insert(tables.project).values({
			id: "test-project-id",
			name: "Test Project",
			organizationId: "test-org-id",
		});
		await db.insert(tables.apiKey).values({
			id: "test-api-key-id",
			...hashApiKeyForStorage("test-token"),
			projectId: "test-project-id",
			description: "Test API Key",
			createdBy: "test-user-id",
		});
	});

	async function patchStatus(status: "active" | "inactive") {
		return await app.request("/keys/api/test-api-key-id", {
			method: "PATCH",
			headers: {
				"Content-Type": "application/json",
				Cookie: token,
			},
			body: JSON.stringify({ status }),
		});
	}

	test("PATCH /keys/api/{id} cannot reactivate a deleted key", async () => {
		await db
			.update(tables.apiKey)
			.set({ status: "deleted" })
			.where(eq(tables.apiKey.id, "test-api-key-id"));

		const res = await patchStatus("active");

		expect(res.status).toBe(404);
		const key = await db.query.apiKey.findFirst({
			where: { id: { eq: "test-api-key-id" } },
		});
		expect(key?.status).toBe("deleted");
	});

	test("PATCH /keys/api/{id} reactivation respects the org active-key cap", async () => {
		await db
			.update(tables.organization)
			.set({ apiKeyLimit: 1 })
			.where(eq(tables.organization.id, "test-org-id"));
		await db
			.update(tables.apiKey)
			.set({ status: "inactive" })
			.where(eq(tables.apiKey.id, "test-api-key-id"));
		await db.insert(tables.apiKey).values({
			id: "test-api-key-id-2",
			...hashApiKeyForStorage("test-token-2"),
			projectId: "test-project-id",
			description: "Test API Key 2",
			status: "active",
			createdBy: "test-user-id",
		});

		const res = await patchStatus("active");

		expect(res.status).toBe(400);
		expect((await res.json()).message).toContain("API key limit reached");
		const key = await db.query.apiKey.findFirst({
			where: { id: { eq: "test-api-key-id" } },
		});
		expect(key?.status).toBe("inactive");
	});

	test("POST /keys/api ignores active keys in deleted projects for the cap", async () => {
		await db
			.update(tables.organization)
			.set({ apiKeyLimit: 1 })
			.where(eq(tables.organization.id, "test-org-id"));
		await db
			.update(tables.apiKey)
			.set({ status: "inactive" })
			.where(eq(tables.apiKey.id, "test-api-key-id"));
		await db.insert(tables.project).values({
			id: "deleted-project-id",
			name: "Deleted Project",
			organizationId: "test-org-id",
			status: "deleted",
		});
		await db.insert(tables.apiKey).values({
			id: "deleted-project-key-id",
			...hashApiKeyForStorage("deleted-project-token"),
			projectId: "deleted-project-id",
			description: "Key In Deleted Project",
			status: "active",
			createdBy: "test-user-id",
		});

		const res = await app.request("/keys/api", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Cookie: token,
			},
			body: JSON.stringify({
				description: "New API Key",
				projectId: "test-project-id",
				usageLimit: null,
			}),
		});

		expect(res.status).toBe(200);
	});
});
