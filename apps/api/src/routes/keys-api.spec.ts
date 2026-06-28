import { expect, test, beforeEach, describe, afterEach } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { redisClient, SWR_PREFIX, swrWrap } from "@llmgateway/cache";
import { db, eq, getTableName, tables } from "@llmgateway/db";

const ONE_MINUTE_MS = 60 * 1000;
const ONE_HOUR_MS = 60 * ONE_MINUTE_MS;

function getActivePeriodStartedAt() {
	return new Date(Date.now() - ONE_HOUR_MS);
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

		// Create test project (Payments SDK preview opted in)
		await db.insert(tables.project).values({
			id: "test-project-id",
			name: "Test Project",
			organizationId: "test-org-id",
			paymentsSdkEnabled: true,
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

	test("POST /keys/platform rejects projects without Payments SDK preview", async () => {
		await db
			.update(tables.project)
			.set({ paymentsSdkEnabled: false })
			.where(eq(tables.project.id, "test-project-id"));

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

		expect(res.status).toBe(403);

		const platformKeys = await db.query.apiKey.findMany({
			where: {
				projectId: { eq: "test-project-id" },
				keyType: { eq: "platform_secret" },
			},
		});
		expect(platformKeys).toHaveLength(0);
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

	test("POST /keys/api/{id}/roll unauthorized", async () => {
		const res = await app.request("/keys/api/test-api-key-id/roll", {
			method: "POST",
		});
		expect(res.status).toBe(401);
	});

	test("POST /keys/api/{id}/roll regenerates the secret and keeps metadata", async () => {
		// Give the key some usage and a limit to prove they survive the roll.
		await db
			.update(tables.apiKey)
			.set({ usage: "12.34", usageLimit: "100", description: "Keep Me" })
			.where(eq(tables.apiKey.id, "test-api-key-id"));

		const res = await app.request("/keys/api/test-api-key-id/roll", {
			method: "POST",
			headers: {
				Cookie: token,
			},
		});
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json).toHaveProperty("message");
		expect(json).toHaveProperty("apiKey");
		// Full new secret is returned once, and it differs from the old one.
		expect(typeof json.apiKey.token).toBe("string");
		expect(json.apiKey.token).not.toBe("test-token");
		expect(json.apiKey.id).toBe("test-api-key-id");

		// Verify the DB was updated and metadata/stats are intact.
		const apiKey = await db.query.apiKey.findFirst({
			where: {
				id: {
					eq: "test-api-key-id",
				},
			},
		});
		expect(apiKey?.token).toBe(json.apiKey.token);
		expect(apiKey?.token).not.toBe("test-token");
		expect(apiKey?.description).toBe("Keep Me");
		expect(apiKey?.usage).toBe("12.34");
		expect(apiKey?.usageLimit).toBe("100");
	});

	test("POST /keys/api/{id}/roll returns 404 for unknown key", async () => {
		const res = await app.request("/keys/api/does-not-exist/roll", {
			method: "POST",
			headers: {
				Cookie: token,
			},
		});
		expect(res.status).toBe(404);
	});

	test("POST /keys/api/{id}/roll invalidates the gateway api_key cache", async () => {
		// The gateway resolves tokens through an SWR-mirrored, cached lookup tagged
		// with the api_key table. Roll must invalidate that cache so the old secret
		// stops authenticating immediately. Seed an SWR entry the way the gateway
		// would, then confirm the roll clears it.
		const apiKeyTableName = getTableName(tables.apiKey);
		const swrCacheKey = "apiKey:token:test-token-fingerprint";
		await swrWrap(swrCacheKey, [apiKeyTableName], async () => ({
			token: "test-token",
		}));
		expect(await redisClient.get(SWR_PREFIX + swrCacheKey)).not.toBeNull();

		const res = await app.request("/keys/api/test-api-key-id/roll", {
			method: "POST",
			headers: {
				Cookie: token,
			},
		});
		expect(res.status).toBe(200);

		// The cached lookup for the old token must be gone after the roll.
		expect(await redisClient.get(SWR_PREFIX + swrCacheKey)).toBeNull();
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

	test("POST /keys/api stores a future expiration (TTL)", async () => {
		const expiresAt = new Date(Date.now() + ONE_HOUR_MS).toISOString();
		const res = await app.request("/keys/api", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Cookie: token,
			},
			body: JSON.stringify({
				description: "Expiring API Key",
				projectId: "test-project-id",
				expiresAt,
			}),
		});

		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.apiKey.expiresAt).toBe(expiresAt);

		const apiKey = await db.query.apiKey.findFirst({
			where: {
				description: {
					eq: "Expiring API Key",
				},
			},
		});

		expect(apiKey?.expiresAt?.toISOString()).toBe(expiresAt);
	});

	test("POST /keys/api rejects an expiration in the past", async () => {
		const res = await app.request("/keys/api", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Cookie: token,
			},
			body: JSON.stringify({
				description: "Already Expired API Key",
				projectId: "test-project-id",
				expiresAt: new Date(Date.now() - ONE_MINUTE_MS).toISOString(),
			}),
		});

		expect(res.status).toBe(400);
		const json = await res.json();
		expect(json.message).toContain("Expiration date must be in the future");
	});

	test("PATCH /keys/api/{id} requires a future TTL to reactivate an expired key", async () => {
		await db
			.update(tables.apiKey)
			.set({
				status: "inactive",
				expiresAt: new Date(Date.now() - ONE_MINUTE_MS),
			})
			.where(eq(tables.apiKey.id, "test-api-key-id"));

		const rejected = await app.request("/keys/api/test-api-key-id", {
			method: "PATCH",
			headers: {
				"Content-Type": "application/json",
				Cookie: token,
			},
			body: JSON.stringify({
				status: "active",
			}),
		});

		expect(rejected.status).toBe(400);
		const rejectedJson = await rejected.json();
		expect(rejectedJson.message).toContain("future expiration date");

		const stillInactive = await db.query.apiKey.findFirst({
			where: { id: { eq: "test-api-key-id" } },
		});
		expect(stillInactive?.status).toBe("inactive");

		const newExpiry = new Date(Date.now() + ONE_HOUR_MS).toISOString();
		const accepted = await app.request("/keys/api/test-api-key-id", {
			method: "PATCH",
			headers: {
				"Content-Type": "application/json",
				Cookie: token,
			},
			body: JSON.stringify({
				status: "active",
				expiresAt: newExpiry,
			}),
		});

		expect(accepted.status).toBe(200);
		const acceptedJson = await accepted.json();
		expect(acceptedJson.apiKey.status).toBe("active");
		expect(acceptedJson.apiKey.expiresAt).toBe(newExpiry);

		const reactivated = await db.query.apiKey.findFirst({
			where: { id: { eq: "test-api-key-id" } },
		});
		expect(reactivated?.status).toBe("active");
		expect(reactivated?.expiresAt?.toISOString()).toBe(newExpiry);
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
