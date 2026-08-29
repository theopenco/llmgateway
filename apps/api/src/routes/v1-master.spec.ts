import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import {
	redisClient,
	SWR_PREFIX,
	swrWrap,
	waitForSwrMirrorWrites,
} from "@llmgateway/cache";
import { and, cdb, db, eq, getTableName, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";
import { getApiKeyFingerprint } from "@llmgateway/shared/api-key-hash";

const ORIGINAL_HASH_SECRET = process.env.GATEWAY_API_KEY_HASH_SECRET;

function setHashSecret(value: string | undefined) {
	if (value === undefined) {
		delete process.env.GATEWAY_API_KEY_HASH_SECRET;
	} else {
		process.env.GATEWAY_API_KEY_HASH_SECRET = value;
	}
}

// Issue #2674: management mutations on gateway-cached tables must go through the
// cached client (cdb) so RedisCache.onMutate invalidates the gateway's SWR
// mirrors. v1-master mutates apiKey, apiKeyIamRule and project, which the gateway
// resolves through swrWrap-cached lookups (apps/gateway/src/lib/cached-queries.ts).
// Each test primes the cache exactly as the gateway would, mutates through the
// master-key route, then asserts BOTH the SWR mirror is evicted AND a fresh cdb
// select serves the new value.

// Seed an SWR mirror entry the way the gateway would and confirm it landed.
async function primeSwrEntry<T>(key: string, table: string, value: T) {
	await swrWrap(key, [table], async () => value);
	await waitForSwrMirrorWrites();
	expect(await redisClient.get(SWR_PREFIX + key)).not.toBeNull();
}

async function assertSwrCleared(key: string) {
	expect(await redisClient.get(SWR_PREFIX + key)).toBeNull();
}

async function readActiveIamRules(apiKeyId: string) {
	const rules = await swrWrap(
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
	await waitForSwrMirrorWrites();
	return rules;
}

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
			...hashApiKeyForStorage("test-master-token"),
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
		setHashSecret(ORIGINAL_HASH_SECRET);
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

	test("authenticates master keys hashed with a retained secret", async () => {
		setHashSecret("retained-secret");
		const retainedHash = getApiKeyFingerprint(masterToken);
		setHashSecret("current-secret,retained-secret");
		await db
			.update(tables.masterKey)
			.set({ tokenHash: retainedHash })
			.where(eq(tables.masterKey.id, "test-master-key-id"));

		const res = await app.request("/v1/master/keys", {
			headers: authHeaders(),
		});
		expect(res.status).toBe(200);
	});

	test("GET /keys hides playground session keys", async () => {
		await db.insert(tables.apiKey).values({
			id: "playground-session-key",
			...hashApiKeyForStorage("playground-session-token"),
			projectId: "test-project-id",
			description: "Session key",
			kind: "playground",
			createdBy: "test-user-id",
		});

		const res = await app.request("/v1/master/keys", {
			headers: authHeaders(),
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.apiKeys).toHaveLength(1);
		expect(body.apiKeys[0]?.id).toBe("test-api-key-id");
	});

	test("managed playground keys reject master-key mutations", async () => {
		await db.insert(tables.apiKey).values({
			id: "playground-key",
			...hashApiKeyForStorage("playground-token"),
			projectId: "test-project-id",
			description: "Playground",
			kind: "playground",
			createdBy: "test-user-id",
		});

		const update = await app.request("/v1/master/keys/playground-key", {
			method: "PATCH",
			headers: authHeaders({ "Content-Type": "application/json" }),
			body: JSON.stringify({ usageLimit: "10" }),
		});
		expect(update.status).toBe(403);

		const remove = await app.request("/v1/master/keys/playground-key", {
			method: "DELETE",
			headers: authHeaders(),
		});
		expect(remove.status).toBe(403);
	});

	test("managed playground keys reject master-key IAM mutations", async () => {
		await db.insert(tables.apiKey).values({
			id: "playground-key",
			...hashApiKeyForStorage("playground-token"),
			projectId: "test-project-id",
			description: "Playground",
			kind: "playground",
			createdBy: "test-user-id",
		});
		const [rule] = await db
			.insert(tables.apiKeyIamRule)
			.values({
				apiKeyId: "playground-key",
				ruleType: "allow_models",
				ruleValue: { models: ["openai/gpt-4o-mini"] },
			})
			.returning();

		const create = await app.request("/v1/master/keys/playground-key/iam", {
			method: "POST",
			headers: authHeaders({ "Content-Type": "application/json" }),
			body: JSON.stringify({
				ruleType: "deny_models",
				ruleValue: { models: ["openai/gpt-4o-mini"] },
			}),
		});
		expect(create.status).toBe(403);

		const update = await app.request(
			`/v1/master/keys/playground-key/iam/${rule.id}`,
			{
				method: "PATCH",
				headers: authHeaders({ "Content-Type": "application/json" }),
				body: JSON.stringify({ status: "inactive" }),
			},
		);
		expect(update.status).toBe(403);

		const remove = await app.request(
			`/v1/master/keys/playground-key/iam/${rule.id}`,
			{
				method: "DELETE",
				headers: authHeaders(),
			},
		);
		expect(remove.status).toBe(403);

		const rules = await db.query.apiKeyIamRule.findMany({
			where: { apiKeyId: { eq: "playground-key" } },
		});
		expect(rules).toHaveLength(1);
		expect(rules[0]?.status).toBe("active");
	});

	test("PATCH /keys allows the playground description on a regular key", async () => {
		const res = await app.request("/v1/master/keys/test-api-key-id", {
			method: "PATCH",
			headers: authHeaders({ "Content-Type": "application/json" }),
			body: JSON.stringify({
				description: "Auto-generated playground key",
			}),
		});

		expect(res.status).toBe(200);
		const key = await db.query.apiKey.findFirst({
			where: { id: { eq: "test-api-key-id" } },
		});
		expect(key?.description).toBe("Auto-generated playground key");
		expect(key?.kind).toBe("regular");
	});

	test("GET /keys maps each creator to their email", async () => {
		await db.insert(tables.user).values({
			id: "member-user-id",
			name: "Member User",
			email: "member@example.com",
			emailVerified: true,
		});
		await db.insert(tables.apiKey).values({
			id: "member-api-key-id",
			...hashApiKeyForStorage("member-api-key-token"),
			projectId: "test-project-id",
			description: "Member API Key",
			createdBy: "member-user-id",
		});

		const listRes = await app.request("/v1/master/keys", {
			headers: authHeaders(),
		});
		expect(listRes.status).toBe(200);
		const list = await listRes.json();
		expect(
			list.apiKeys.find(
				(apiKey: { id: string }) => apiKey.id === "member-api-key-id",
			),
		).toMatchObject({
			projectName: "Test Project",
			createdBy: "member-user-id",
			createdByEmail: "member@example.com",
		});

		const detailRes = await app.request("/v1/master/keys/member-api-key-id", {
			headers: authHeaders(),
		});
		expect(detailRes.status).toBe(200);
		const detail = await detailRes.json();
		expect(detail.apiKey.projectName).toBe("Test Project");
		expect(detail.apiKey.createdByEmail).toBe("member@example.com");
	});

	test("PATCH /keys/{id} invalidates the gateway api_key cache", async () => {
		// A per-run-unique key keeps the SWR key from colliding with entries left
		// in Redis by earlier runs, which outlive deleteAll (it does not flush
		// Redis).
		const apiKeyId = `cache-test-api-key-${crypto.randomUUID()}`;
		const apiKeyToken = `${apiKeyId}-token`;
		await db.insert(tables.apiKey).values({
			id: apiKeyId,
			...hashApiKeyForStorage(apiKeyToken),
			projectId: "test-project-id",
			description: "Cache Test Key",
			createdBy: "test-user-id",
		});

		const swrCacheKey = `apiKey:token:${getApiKeyFingerprint(apiKeyToken)}`;
		await primeSwrEntry(swrCacheKey, getTableName(tables.apiKey), {
			token: apiKeyToken,
			status: "active",
		});

		const res = await app.request(`/v1/master/keys/${apiKeyId}`, {
			method: "PATCH",
			headers: authHeaders({ "Content-Type": "application/json" }),
			body: JSON.stringify({ status: "inactive" }),
		});
		expect(res.status).toBe(200);

		await assertSwrCleared(swrCacheKey);
		// The cached cdb select must reflect the new status, not the stale one.
		const fresh = await cdb
			.select()
			.from(tables.apiKey)
			.where(eq(tables.apiKey.id, apiKeyId));
		expect(fresh[0]?.status).toBe("inactive");
	});

	test("DELETE /keys/{id} invalidates the gateway api_key cache", async () => {
		const apiKeyId = `cache-test-api-key-${crypto.randomUUID()}`;
		const apiKeyToken = `${apiKeyId}-token`;
		await db.insert(tables.apiKey).values({
			id: apiKeyId,
			...hashApiKeyForStorage(apiKeyToken),
			projectId: "test-project-id",
			description: "Cache Test Key",
			createdBy: "test-user-id",
		});

		const swrCacheKey = `apiKey:token:${getApiKeyFingerprint(apiKeyToken)}`;
		await primeSwrEntry(swrCacheKey, getTableName(tables.apiKey), {
			token: apiKeyToken,
			status: "active",
		});

		const res = await app.request(`/v1/master/keys/${apiKeyId}`, {
			method: "DELETE",
			headers: authHeaders(),
		});
		expect(res.status).toBe(200);

		await assertSwrCleared(swrCacheKey);
		const fresh = await cdb
			.select()
			.from(tables.apiKey)
			.where(eq(tables.apiKey.id, apiKeyId));
		expect(fresh[0]?.status).toBe("deleted");
	});

	test("PATCH /projects/{id} invalidates the gateway project cache", async () => {
		const projectId = `cache-test-project-${crypto.randomUUID()}`;
		await db.insert(tables.project).values({
			id: projectId,
			name: "Cache Test Project",
			organizationId: "test-org-id",
		});

		const swrCacheKey = `project:${projectId}`;
		await primeSwrEntry(swrCacheKey, getTableName(tables.project), {
			id: projectId,
			name: "Cache Test Project",
		});

		const res = await app.request(`/v1/master/projects/${projectId}`, {
			method: "PATCH",
			headers: authHeaders({ "Content-Type": "application/json" }),
			body: JSON.stringify({ name: "Renamed Project" }),
		});
		expect(res.status).toBe(200);

		await assertSwrCleared(swrCacheKey);
		const fresh = await cdb
			.select()
			.from(tables.project)
			.where(eq(tables.project.id, projectId));
		expect(fresh[0]?.name).toBe("Renamed Project");
	});

	test("DELETE /projects/{id} invalidates the gateway project cache", async () => {
		const projectId = `cache-test-project-${crypto.randomUUID()}`;
		await db.insert(tables.project).values({
			id: projectId,
			name: "Cache Test Project",
			organizationId: "test-org-id",
		});

		const swrCacheKey = `project:${projectId}`;
		await primeSwrEntry(swrCacheKey, getTableName(tables.project), {
			id: projectId,
			status: "active",
		});

		const res = await app.request(`/v1/master/projects/${projectId}`, {
			method: "DELETE",
			headers: authHeaders(),
		});
		expect(res.status).toBe(200);

		await assertSwrCleared(swrCacheKey);
		const fresh = await cdb
			.select()
			.from(tables.project)
			.where(eq(tables.project.id, projectId));
		expect(fresh[0]?.status).toBe("deleted");
	});

	test("POST /keys/{id}/iam busts the gateway's cached IAM rule lookups", async () => {
		// The gateway enforces IAM rules through a cached select (cdb) wrapped in
		// an SWR fallback mirror, both indexed by the api_key_iam_rule table (see
		// findActiveIamRules in apps/gateway/src/lib/cached-queries.ts). Creating a
		// rule through cdb must bust both layers so it applies immediately.
		const apiKeyId = `cache-test-api-key-${crypto.randomUUID()}`;
		await db.insert(tables.apiKey).values({
			id: apiKeyId,
			...hashApiKeyForStorage(`${apiKeyId}-token`),
			projectId: "test-project-id",
			description: "IAM Cache Test Key",
			createdBy: "test-user-id",
		});

		expect(await readActiveIamRules(apiKeyId)).toHaveLength(0);
		await primeSwrEntry(
			`iamRules:${apiKeyId}`,
			getTableName(tables.apiKeyIamRule),
			[],
		);

		const res = await app.request(`/v1/master/keys/${apiKeyId}/iam`, {
			method: "POST",
			headers: authHeaders({ "Content-Type": "application/json" }),
			body: JSON.stringify({
				ruleType: "allow_models",
				ruleValue: { models: ["openai/gpt-4o-mini"] },
			}),
		});
		expect(res.status).toBe(201);

		await assertSwrCleared(`iamRules:${apiKeyId}`);
		const directRules = await cdb
			.select()
			.from(tables.apiKeyIamRule)
			.where(
				and(
					eq(tables.apiKeyIamRule.apiKeyId, apiKeyId),
					eq(tables.apiKeyIamRule.status, "active"),
				),
			);
		expect(directRules).toHaveLength(1);
		expect(await readActiveIamRules(apiKeyId)).toHaveLength(1);
	});

	test("PATCH /keys/{id}/iam/{ruleId} busts the gateway's cached IAM rule lookups", async () => {
		const apiKeyId = `cache-test-api-key-${crypto.randomUUID()}`;
		await db.insert(tables.apiKey).values({
			id: apiKeyId,
			...hashApiKeyForStorage(`${apiKeyId}-token`),
			projectId: "test-project-id",
			description: "IAM Cache Test Key",
			createdBy: "test-user-id",
		});
		const [rule] = await db
			.insert(tables.apiKeyIamRule)
			.values({
				apiKeyId,
				ruleType: "allow_models",
				ruleValue: { models: ["openai/gpt-4o-mini"] },
			})
			.returning();

		expect(await readActiveIamRules(apiKeyId)).toHaveLength(1);
		await primeSwrEntry(
			`iamRules:${apiKeyId}`,
			getTableName(tables.apiKeyIamRule),
			[rule],
		);

		const res = await app.request(
			`/v1/master/keys/${apiKeyId}/iam/${rule.id}`,
			{
				method: "PATCH",
				headers: authHeaders({ "Content-Type": "application/json" }),
				body: JSON.stringify({
					ruleValue: { models: ["anthropic/claude-3-5-sonnet"] },
				}),
			},
		);
		expect(res.status).toBe(200);

		await assertSwrCleared(`iamRules:${apiKeyId}`);
		const directRules = await cdb
			.select()
			.from(tables.apiKeyIamRule)
			.where(
				and(
					eq(tables.apiKeyIamRule.apiKeyId, apiKeyId),
					eq(tables.apiKeyIamRule.status, "active"),
				),
			);
		expect(directRules).toHaveLength(1);
		expect(directRules[0]?.ruleValue).toEqual({
			models: ["anthropic/claude-3-5-sonnet"],
		});
		const rules = await readActiveIamRules(apiKeyId);
		expect(rules).toHaveLength(1);
		expect(rules[0]?.ruleValue).toEqual({
			models: ["anthropic/claude-3-5-sonnet"],
		});
	});

	test("DELETE /keys/{id}/iam/{ruleId} busts the gateway's cached IAM rule lookups", async () => {
		const apiKeyId = `cache-test-api-key-${crypto.randomUUID()}`;
		await db.insert(tables.apiKey).values({
			id: apiKeyId,
			...hashApiKeyForStorage(`${apiKeyId}-token`),
			projectId: "test-project-id",
			description: "IAM Cache Test Key",
			createdBy: "test-user-id",
		});
		const [rule] = await db
			.insert(tables.apiKeyIamRule)
			.values({
				apiKeyId,
				ruleType: "allow_models",
				ruleValue: { models: ["openai/gpt-4o-mini"] },
			})
			.returning();

		expect(await readActiveIamRules(apiKeyId)).toHaveLength(1);
		await primeSwrEntry(
			`iamRules:${apiKeyId}`,
			getTableName(tables.apiKeyIamRule),
			[rule],
		);

		const res = await app.request(
			`/v1/master/keys/${apiKeyId}/iam/${rule.id}`,
			{
				method: "DELETE",
				headers: authHeaders(),
			},
		);
		expect(res.status).toBe(200);

		await assertSwrCleared(`iamRules:${apiKeyId}`);
		const directRules = await cdb
			.select()
			.from(tables.apiKeyIamRule)
			.where(
				and(
					eq(tables.apiKeyIamRule.apiKeyId, apiKeyId),
					eq(tables.apiKeyIamRule.status, "active"),
				),
			);
		expect(directRules).toHaveLength(0);
		expect(await readActiveIamRules(apiKeyId)).toHaveLength(0);
	});
});
