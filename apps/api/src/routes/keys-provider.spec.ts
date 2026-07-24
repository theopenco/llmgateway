import { expect, test, beforeEach, describe, afterEach } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { redisClient, SWR_PREFIX, swrWrap } from "@llmgateway/cache";
import { and, cdb, db, eq, getTableName, tables } from "@llmgateway/db";

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
			billingEmail: "test@example.com",
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
		expect(json.providerKey.maskedToken).toBeDefined();
		expect(json.providerKey.maskedToken).toContain("•");
		expect(json.providerKey.token).toBeUndefined();

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

	test("POST /keys/provider rejects token with non-ASCII characters", async () => {
		const res = await app.request("/keys/provider", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Cookie: token,
			},
			body: JSON.stringify({
				provider: "openai",
				token: "sk-realprefix••••••••",
				organizationId: "test-org-id",
			}),
		});
		expect(res.status).toBe(400);
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

	test("POST /keys/provider rejects stealth providers", async () => {
		const res = await app.request("/keys/provider", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Cookie: token,
			},
			body: JSON.stringify({
				provider: "granite",
				token: "granite-test-token",
				organizationId: "test-org-id",
			}),
		});
		expect(res.status).toBe(400);
		const json = await res.json();
		expect(json.message).toContain("cannot be configured with a provider key");

		// Verify no key was created
		const providerKey = await db.query.providerKey.findFirst({
			where: {
				provider: {
					eq: "granite",
				},
			},
		});
		expect(providerKey).toBeUndefined();
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
				token: "test-provider-token-2",
				organizationId: "test-org-id",
			}),
		});
		expect(res.status).toBe(200);

		const providerKeys = await db.query.providerKey.findMany({
			where: {
				provider: {
					eq: "openai",
				},
			},
		});
		expect(providerKeys).toHaveLength(2);
	});

	test("POST /keys/provider rejects duplicate custom provider names", async () => {
		await db.insert(tables.providerKey).values({
			id: "test-custom-provider-key-id",
			token: "test-custom-provider-token",
			provider: "custom",
			name: "mycustomprovider",
			baseUrl: "https://example.com",
			organizationId: "test-org-id",
		});

		const res = await app.request("/keys/provider", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Cookie: token,
			},
			body: JSON.stringify({
				provider: "custom",
				token: "test-custom-provider-token-2",
				name: "mycustomprovider",
				baseUrl: "https://example-2.com",
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

	// The gateway resolves provider keys through a cached select (cdb) wrapped
	// in an SWR fallback mirror, both indexed by the provider_key table (see
	// apps/gateway/src/lib/cached-queries.ts). Mutations must go through cdb so
	// its onMutate busts both layers; otherwise the gateway serves stale keys
	// until the cache TTL expires.
	//
	// Each test uses its own org so the cache keys (SWR key and Drizzle query
	// hash, which includes the bind params) are unique per run — cached entries
	// in Redis outlive deleteAll() and would otherwise leak between runs.
	async function createCacheTestOrg() {
		const orgId = `cache-test-org-${crypto.randomUUID()}`;
		await db.insert(tables.organization).values({
			id: orgId,
			name: "Cache Test Organization",
			billingEmail: "cache-test@example.com",
			plan: "pro",
		});
		await db.insert(tables.userOrganization).values({
			id: `${orgId}-membership`,
			userId: "test-user-id",
			organizationId: orgId,
			role: "owner",
		});
		await db.insert(tables.project).values({
			id: `${orgId}-project`,
			name: "Cache Test Project",
			organizationId: orgId,
		});
		return orgId;
	}

	function readActiveProviderKeys(orgId: string, provider: string) {
		return swrWrap(
			`providerKey:${orgId}:${provider}`,
			[getTableName(tables.providerKey)],
			async () =>
				await cdb
					.select()
					.from(tables.providerKey)
					.where(
						and(
							eq(tables.providerKey.status, "active"),
							eq(tables.providerKey.organizationId, orgId),
							eq(tables.providerKey.provider, provider),
						),
					),
		);
	}

	test("POST /keys/provider makes the new key visible to cached lookups", async () => {
		const orgId = await createCacheTestOrg();

		// Prime both cache layers with the "no key" result.
		expect(await readActiveProviderKeys(orgId, "anthropic")).toHaveLength(0);
		expect(
			await redisClient.get(SWR_PREFIX + `providerKey:${orgId}:anthropic`),
		).not.toBeNull();

		const res = await app.request("/keys/provider", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Cookie: token,
			},
			body: JSON.stringify({
				provider: "anthropic",
				token: "anthropic-test-token",
				organizationId: orgId,
			}),
		});
		expect(res.status).toBe(200);

		// The SWR mirror for the provider_key table must be gone...
		expect(
			await redisClient.get(SWR_PREFIX + `providerKey:${orgId}:anthropic`),
		).toBeNull();
		// ...and the cached select must serve the new key, not the stale miss.
		expect(await readActiveProviderKeys(orgId, "anthropic")).toHaveLength(1);
	});

	test("PATCH /keys/provider/{id} busts cached lookups of the key", async () => {
		const orgId = await createCacheTestOrg();
		await db.insert(tables.providerKey).values({
			id: `${orgId}-provider-key`,
			token: "cache-test-provider-token",
			provider: "openai",
			organizationId: orgId,
		});

		// Prime both cache layers with the key still active.
		expect(await readActiveProviderKeys(orgId, "openai")).toHaveLength(1);
		expect(
			await redisClient.get(SWR_PREFIX + `providerKey:${orgId}:openai`),
		).not.toBeNull();

		const res = await app.request(`/keys/provider/${orgId}-provider-key`, {
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

		// The SWR mirror for the provider_key table must be gone...
		expect(
			await redisClient.get(SWR_PREFIX + `providerKey:${orgId}:openai`),
		).toBeNull();
		// ...and the cached select must reflect the deactivation immediately.
		expect(await readActiveProviderKeys(orgId, "openai")).toHaveLength(0);
	});
});
