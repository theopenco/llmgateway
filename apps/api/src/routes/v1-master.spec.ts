import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { redisClient, SWR_PREFIX, swrWrap } from "@llmgateway/cache";
import { and, cdb, db, eq, getTableName, tables } from "@llmgateway/db";
import { getApiKeyFingerprint } from "@llmgateway/shared/api-key-hash";

// These tests cover issue #2674: management mutations on gateway-cached tables
// must go through the cached client (cdb) so RedisCache.onMutate invalidates the
// gateway's SWR mirrors. v1-master mutates apiKey, apiKeyIamRule and project,
// which the gateway resolves through swrWrap-cached lookups (see
// apps/gateway/src/lib/cached-queries.ts). Each test primes the cache exactly as
// the gateway would, mutates through the master-key route, then asserts the
// cache no longer serves the stale value.

describe("v1/master cache invalidation", () => {
	let masterToken: string;

	beforeEach(async () => {
		// createTestUser runs deleteAll and seeds test-user-id.
		await createTestUser();

		await db.insert(tables.organization).values({
			id: "test-org-id",
			name: "Test Organization",
			billingEmail: "test@example.com",
			plan: "enterprise",
		});

		await db.insert(tables.userOrganization).values({
			id: "test-user-org-id",
			userId: "test-user-id",
			organizationId: "test-org-id",
			role: "owner",
		});

		await db.insert(tables.project).values({
			id: "test-project-id",
			name: "Test Project",
			organizationId: "test-org-id",
		});

		await db.insert(tables.apiKey).values({
			id: "test-api-key-id",
			token: "test-master-token",
			projectId: "test-project-id",
			description: "Test API Key",
			createdBy: "test-user-id",
		});

		// The gateway authenticates master keys by hashing the bearer token and
		// matching masterKey.tokenHash (v1-master.ts auth middleware).
		masterToken = `mk-${crypto.randomUUID()}`;
		await db.insert(tables.masterKey).values({
			id: "test-master-key-id",
			tokenHash: getApiKeyFingerprint(masterToken),
			maskedToken: "mk-****",
			description: "Test Master Key",
			status: "active",
			organizationId: "test-org-id",
			createdBy: "test-user-id",
		});
	});

	afterEach(async () => {
		// deleteAll does not target masterKey, but deleting the organization
		// cascades it (masterKey.organizationId ON DELETE cascade).
		await deleteAll();
	});

	function authHeaders(extra: Record<string, string> = {}) {
		return {
			Authorization: `Bearer ${masterToken}`,
			...extra,
		};
	}

	test("PATCH /keys/{id} invalidates the gateway api_key cache", async () => {
		// A per-run-unique key keeps the SWR key from colliding with entries left
		// in Redis by earlier runs, which outlive deleteAll (it does not flush
		// Redis).
		const apiKeyId = `cache-test-api-key-${crypto.randomUUID()}`;
		const apiKeyToken = `${apiKeyId}-token`;
		await db.insert(tables.apiKey).values({
			id: apiKeyId,
			token: apiKeyToken,
			projectId: "test-project-id",
			description: "Cache Test Key",
			createdBy: "test-user-id",
		});

		// Prime the SWR mirror the way the gateway's findApiKeyByToken does.
		const swrCacheKey = `apiKey:token:${getApiKeyFingerprint(apiKeyToken)}`;
		await swrWrap(swrCacheKey, [getTableName(tables.apiKey)], async () => ({
			token: apiKeyToken,
			status: "active",
		}));
		expect(await redisClient.get(SWR_PREFIX + swrCacheKey)).not.toBeNull();

		const res = await app.request(`/v1/master/keys/${apiKeyId}`, {
			method: "PATCH",
			headers: authHeaders({ "Content-Type": "application/json" }),
			body: JSON.stringify({ status: "inactive" }),
		});
		expect(res.status).toBe(200);

		expect(await redisClient.get(SWR_PREFIX + swrCacheKey)).toBeNull();
	});

	test("DELETE /keys/{id} invalidates the gateway api_key cache", async () => {
		const apiKeyId = `cache-test-api-key-${crypto.randomUUID()}`;
		const apiKeyToken = `${apiKeyId}-token`;
		await db.insert(tables.apiKey).values({
			id: apiKeyId,
			token: apiKeyToken,
			projectId: "test-project-id",
			description: "Cache Test Key",
			createdBy: "test-user-id",
		});

		const swrCacheKey = `apiKey:token:${getApiKeyFingerprint(apiKeyToken)}`;
		await swrWrap(swrCacheKey, [getTableName(tables.apiKey)], async () => ({
			token: apiKeyToken,
			status: "active",
		}));
		expect(await redisClient.get(SWR_PREFIX + swrCacheKey)).not.toBeNull();

		const res = await app.request(`/v1/master/keys/${apiKeyId}`, {
			method: "DELETE",
			headers: authHeaders(),
		});
		expect(res.status).toBe(200);

		expect(await redisClient.get(SWR_PREFIX + swrCacheKey)).toBeNull();
	});

	test("DELETE /projects/{id} invalidates the gateway project cache", async () => {
		const projectId = `cache-test-project-${crypto.randomUUID()}`;
		await db.insert(tables.project).values({
			id: projectId,
			name: "Cache Test Project",
			organizationId: "test-org-id",
		});

		// Prime the SWR mirror the way the gateway's findProjectById does.
		const swrCacheKey = `project:${projectId}`;
		await swrWrap(swrCacheKey, [getTableName(tables.project)], async () => ({
			id: projectId,
			status: "active",
		}));
		expect(await redisClient.get(SWR_PREFIX + swrCacheKey)).not.toBeNull();

		const res = await app.request(`/v1/master/projects/${projectId}`, {
			method: "DELETE",
			headers: authHeaders(),
		});
		expect(res.status).toBe(200);

		expect(await redisClient.get(SWR_PREFIX + swrCacheKey)).toBeNull();
	});

	test("POST /keys/{id}/iam busts the gateway's cached IAM rule lookups", async () => {
		// The gateway enforces IAM rules through a cached select (cdb) wrapped in
		// an SWR fallback mirror, both indexed by the api_key_iam_rule table (see
		// findActiveIamRules in apps/gateway/src/lib/cached-queries.ts). Creating a
		// rule through cdb must bust both layers so it applies immediately.
		const apiKeyId = `cache-test-api-key-${crypto.randomUUID()}`;
		await db.insert(tables.apiKey).values({
			id: apiKeyId,
			token: `${apiKeyId}-token`,
			projectId: "test-project-id",
			description: "IAM Cache Test Key",
			createdBy: "test-user-id",
		});

		const readActiveIamRules = () =>
			swrWrap(
				`iamRules:${apiKeyId}`,
				[getTableName(tables.apiKeyIamRule)],
				async () =>
					await cdb
						.select()
						.from(tables.apiKeyIamRule)
						.where(
							and(
								eq(tables.apiKeyIamRule.apiKeyId, apiKeyId),
								eq(tables.apiKeyIamRule.status, "active"),
							),
						),
			);

		// Prime both cache layers with the "no rules" result.
		expect(await readActiveIamRules()).toHaveLength(0);
		expect(
			await redisClient.get(SWR_PREFIX + `iamRules:${apiKeyId}`),
		).not.toBeNull();

		const res = await app.request(`/v1/master/keys/${apiKeyId}/iam`, {
			method: "POST",
			headers: authHeaders({ "Content-Type": "application/json" }),
			body: JSON.stringify({
				ruleType: "allow_models",
				ruleValue: { models: ["openai/gpt-4o-mini"] },
			}),
		});
		expect(res.status).toBe(200);

		// The SWR mirror for the api_key_iam_rule table must be gone...
		expect(
			await redisClient.get(SWR_PREFIX + `iamRules:${apiKeyId}`),
		).toBeNull();
		// ...and the cached select must serve the new rule, not the stale miss.
		expect(await readActiveIamRules()).toHaveLength(1);
	});
});
