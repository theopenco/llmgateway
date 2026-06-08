import { expect, test, beforeEach, describe, afterEach } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, eq, tables } from "@llmgateway/db";

function getActivePeriodStartedAt() {
	const oneHourInMs = 60 * 60 * 1000;
	return new Date(Date.now() - oneHourInMs);
}

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
			billingEmail: "test@example.com",
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

	test("POST /keys/platform creates an SDK platform secret", async () => {
		const res = await app.request("/keys/platform", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Cookie: token,
			},
			body: JSON.stringify({
				projectId: "test-project-id",
				description: "LLM SDK test secret",
			}),
		});

		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.platformKey.token.startsWith("sk_")).toBe(true);
		expect(json.platformKey.maskedToken.startsWith("sk_")).toBe(true);
		expect(json.platformKey.description).toBe("LLM SDK test secret");

		const platformKey = await db.query.apiKey.findFirst({
			where: {
				id: {
					eq: json.platformKey.id,
				},
			},
		});
		expect(platformKey?.keyType).toBe("platform_secret");
		expect(platformKey?.token).toBe(json.platformKey.token);
	});

	test("GET /keys/platform lists masked SDK platform secrets", async () => {
		await db.insert(tables.apiKey).values({
			id: "test-platform-key-id",
			token: "sk_test_platform_secret",
			projectId: "test-project-id",
			description: "Platform Secret",
			keyType: "platform_secret",
			createdBy: "test-user-id",
		});

		const res = await app.request("/keys/platform?projectId=test-project-id", {
			headers: {
				Cookie: token,
			},
		});

		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.platformKeys).toHaveLength(1);
		expect(json.platformKeys[0].id).toBe("test-platform-key-id");
		expect(json.platformKeys[0].maskedToken).toContain("sk_test_plat");
		expect(json.platformKeys[0].token).toBeUndefined();
	});

	test("DELETE /keys/platform/{id} revokes a platform secret", async () => {
		await db.insert(tables.apiKey).values({
			id: "test-platform-key-id",
			token: "sk_test_platform_secret",
			projectId: "test-project-id",
			description: "Platform Secret",
			keyType: "platform_secret",
			createdBy: "test-user-id",
		});

		const res = await app.request("/keys/platform/test-platform-key-id", {
			method: "DELETE",
			headers: {
				Cookie: token,
			},
		});

		expect(res.status).toBe(200);
		const platformKey = await db.query.apiKey.findFirst({
			where: {
				id: {
					eq: "test-platform-key-id",
				},
			},
		});
		expect(platformKey?.status).toBe("deleted");
	});

	test("GET/POST/DELETE /keys/platform rejects organization developers", async () => {
		await db.insert(tables.apiKey).values({
			id: "test-developer-platform-key-id",
			token: "sk_test_developer_platform_secret",
			projectId: "test-project-id",
			description: "Developer Platform Secret",
			keyType: "platform_secret",
			createdBy: "test-user-id",
		});

		await db
			.update(tables.userOrganization)
			.set({ role: "developer" })
			.where(eq(tables.userOrganization.id, "test-user-org-id"));

		const getRes = await app.request(
			"/keys/platform?projectId=test-project-id",
			{
				headers: {
					Cookie: token,
				},
			},
		);

		expect(getRes.status).toBe(403);

		const postRes = await app.request("/keys/platform", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Cookie: token,
			},
			body: JSON.stringify({
				projectId: "test-project-id",
				description: "Developer secret",
			}),
		});

		expect(postRes.status).toBe(403);

		const deleteRes = await app.request(
			"/keys/platform/test-developer-platform-key-id",
			{
				method: "DELETE",
				headers: {
					Cookie: token,
				},
			},
		);

		expect(deleteRes.status).toBe(403);
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

	test("POST /keys/api creates a period usage limit", async () => {
		const res = await app.request("/keys/api", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Cookie: token,
			},
			body: JSON.stringify({
				description: "Windowed API Key",
				projectId: "test-project-id",
				usageLimit: "25",
				periodUsageLimit: "5",
				periodUsageDurationValue: 2,
				periodUsageDurationUnit: "day",
			}),
		});

		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.apiKey.usageLimit).toBe("25");
		expect(json.apiKey.periodUsageLimit).toBe("5");
		expect(json.apiKey.periodUsageDurationValue).toBe(2);
		expect(json.apiKey.periodUsageDurationUnit).toBe("day");
		expect(json.apiKey.currentPeriodUsage).toBe("0");
		expect(json.apiKey.currentPeriodStartedAt).toBeNull();
		expect(json.apiKey.currentPeriodResetAt).toBeNull();

		const apiKey = await db.query.apiKey.findFirst({
			where: {
				description: {
					eq: "Windowed API Key",
				},
			},
		});

		expect(apiKey?.periodUsageLimit).toBe("5");
		expect(apiKey?.periodUsageDurationValue).toBe(2);
		expect(apiKey?.periodUsageDurationUnit).toBe("day");
	});

	test("PATCH /keys/api/limit/{id} updates and resets period usage", async () => {
		await db
			.update(tables.apiKey)
			.set({
				currentPeriodUsage: "3.50",
				currentPeriodStartedAt: new Date("2026-03-29T08:00:00.000Z"),
			})
			.where(eq(tables.apiKey.id, "test-api-key-id"));

		const res = await app.request("/keys/api/limit/test-api-key-id", {
			method: "PATCH",
			headers: {
				"Content-Type": "application/json",
				Cookie: token,
			},
			body: JSON.stringify({
				usageLimit: "50",
				periodUsageLimit: "10",
				periodUsageDurationValue: 1,
				periodUsageDurationUnit: "week",
			}),
		});

		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.message).toBe("API key limits updated successfully.");
		expect(json.apiKey.currentPeriodUsage).toBe("0");
		expect(json.apiKey.currentPeriodStartedAt).toBeNull();
		expect(json.apiKey.currentPeriodResetAt).toBeNull();

		const apiKey = await db.query.apiKey.findFirst({
			where: {
				id: {
					eq: "test-api-key-id",
				},
			},
		});

		expect(apiKey?.usageLimit).toBe("50");
		expect(apiKey?.periodUsageLimit).toBe("10");
		expect(apiKey?.periodUsageDurationValue).toBe(1);
		expect(apiKey?.periodUsageDurationUnit).toBe("week");
		expect(apiKey?.currentPeriodUsage).toBe("0");
		expect(apiKey?.currentPeriodStartedAt).toBeNull();
	});

	test("PATCH /keys/api/limit/{id} preserves recurring limits on partial updates", async () => {
		await db
			.update(tables.apiKey)
			.set({
				usageLimit: "25",
				periodUsageLimit: "5",
				periodUsageDurationValue: 1,
				periodUsageDurationUnit: "day",
				currentPeriodUsage: "2.25",
				currentPeriodStartedAt: getActivePeriodStartedAt(),
			})
			.where(eq(tables.apiKey.id, "test-api-key-id"));

		const res = await app.request("/keys/api/limit/test-api-key-id", {
			method: "PATCH",
			headers: {
				"Content-Type": "application/json",
				Cookie: token,
			},
			body: JSON.stringify({
				usageLimit: "50",
			}),
		});

		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.apiKey.usageLimit).toBe("50");
		expect(json.apiKey.periodUsageLimit).toBe("5");
		expect(json.apiKey.periodUsageDurationValue).toBe(1);
		expect(json.apiKey.periodUsageDurationUnit).toBe("day");
		expect(json.apiKey.currentPeriodUsage).toBe("2.25");
		expect(json.apiKey.currentPeriodStartedAt).not.toBeNull();

		const apiKey = await db.query.apiKey.findFirst({
			where: {
				id: {
					eq: "test-api-key-id",
				},
			},
		});

		expect(apiKey?.usageLimit).toBe("50");
		expect(apiKey?.periodUsageLimit).toBe("5");
		expect(apiKey?.periodUsageDurationValue).toBe(1);
		expect(apiKey?.periodUsageDurationUnit).toBe("day");
		expect(apiKey?.currentPeriodUsage).toBe("2.25");
		expect(apiKey?.currentPeriodStartedAt).not.toBeNull();
	});

	test("PATCH /keys/api/limit/{id} preserves usage limit when omitted", async () => {
		await db
			.update(tables.apiKey)
			.set({
				usageLimit: "25",
				periodUsageLimit: "5",
				periodUsageDurationValue: 1,
				periodUsageDurationUnit: "day",
				currentPeriodUsage: "2.25",
				currentPeriodStartedAt: getActivePeriodStartedAt(),
			})
			.where(eq(tables.apiKey.id, "test-api-key-id"));

		const res = await app.request("/keys/api/limit/test-api-key-id", {
			method: "PATCH",
			headers: {
				"Content-Type": "application/json",
				Cookie: token,
			},
			body: JSON.stringify({
				periodUsageLimit: "8",
				periodUsageDurationValue: 1,
				periodUsageDurationUnit: "week",
			}),
		});

		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.apiKey.usageLimit).toBe("25");
		expect(json.apiKey.periodUsageLimit).toBe("8");
		expect(json.apiKey.periodUsageDurationValue).toBe(1);
		expect(json.apiKey.periodUsageDurationUnit).toBe("week");
		expect(json.apiKey.currentPeriodUsage).toBe("0");
		expect(json.apiKey.currentPeriodStartedAt).toBeNull();

		const apiKey = await db.query.apiKey.findFirst({
			where: {
				id: {
					eq: "test-api-key-id",
				},
			},
		});

		expect(apiKey?.usageLimit).toBe("25");
		expect(apiKey?.periodUsageLimit).toBe("8");
		expect(apiKey?.periodUsageDurationValue).toBe(1);
		expect(apiKey?.periodUsageDurationUnit).toBe("week");
		expect(apiKey?.currentPeriodUsage).toBe("0");
		expect(apiKey?.currentPeriodStartedAt).toBeNull();
	});

	test("PATCH /keys/api/limit/{id} rejects incomplete period limits", async () => {
		const res = await app.request("/keys/api/limit/test-api-key-id", {
			method: "PATCH",
			headers: {
				"Content-Type": "application/json",
				Cookie: token,
			},
			body: JSON.stringify({
				usageLimit: null,
				periodUsageLimit: "5",
				periodUsageDurationValue: null,
				periodUsageDurationUnit: "day",
			}),
		});

		expect(res.status).toBe(400);
		const json = await res.json();
		expect(JSON.stringify(json)).toContain("duration value and unit");
	});

	test("PATCH /keys/api/limit/{id} normalizes blank limits to null", async () => {
		await db
			.update(tables.apiKey)
			.set({
				usageLimit: "25",
				periodUsageLimit: "5",
				periodUsageDurationValue: 1,
				periodUsageDurationUnit: "day",
				currentPeriodUsage: "2.25",
				currentPeriodStartedAt: new Date("2026-03-29T08:00:00.000Z"),
			})
			.where(eq(tables.apiKey.id, "test-api-key-id"));

		const res = await app.request("/keys/api/limit/test-api-key-id", {
			method: "PATCH",
			headers: {
				"Content-Type": "application/json",
				Cookie: token,
			},
			body: JSON.stringify({
				usageLimit: "   ",
				periodUsageLimit: "",
				periodUsageDurationValue: null,
				periodUsageDurationUnit: null,
			}),
		});

		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.apiKey.usageLimit).toBeNull();
		expect(json.apiKey.periodUsageLimit).toBeNull();
		expect(json.apiKey.currentPeriodUsage).toBe("0");
		expect(json.apiKey.currentPeriodStartedAt).toBeNull();

		const apiKey = await db.query.apiKey.findFirst({
			where: {
				id: {
					eq: "test-api-key-id",
				},
			},
		});

		expect(apiKey?.usageLimit).toBeNull();
		expect(apiKey?.periodUsageLimit).toBeNull();
		expect(apiKey?.periodUsageDurationValue).toBeNull();
		expect(apiKey?.periodUsageDurationUnit).toBeNull();
	});

	test("PATCH /keys/api/limit/{id} rejects negative limits", async () => {
		const res = await app.request("/keys/api/limit/test-api-key-id", {
			method: "PATCH",
			headers: {
				"Content-Type": "application/json",
				Cookie: token,
			},
			body: JSON.stringify({
				usageLimit: "-1",
				periodUsageLimit: "5",
				periodUsageDurationValue: 1,
				periodUsageDurationUnit: "day",
			}),
		});

		expect(res.status).toBe(400);
		const json = await res.json();
		expect(JSON.stringify(json)).toContain(
			"Usage limit must be a non-negative number",
		);
	});

	test("POST /keys/api should enforce API key limit of 20", async () => {
		// Create 19 more API keys to reach the limit of 20
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

		// Try to create the 21st API key, should fail
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
		expect(json.message).toContain("Maximum 20 API keys per project");
	});
});
