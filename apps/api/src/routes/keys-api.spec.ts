import { expect, test, beforeEach, describe, afterEach } from "vitest";

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

const ONE_MINUTE_MS = 60 * 1000;
const ONE_HOUR_MS = 60 * ONE_MINUTE_MS;

function getActivePeriodStartedAt() {
	return new Date(Date.now() - ONE_HOUR_MS);
}

/** A second, developer-role member of the test org plus a key they created. */
async function seedOtherMemberKey(budget: {
	usageLimit?: string;
	periodUsageLimit?: string;
	periodUsageDurationValue?: number;
	periodUsageDurationUnit?: "hour" | "day" | "week" | "month";
}) {
	await db.insert(tables.user).values({
		id: "other-user-id",
		name: "Other Developer",
		email: "other-developer@example.com",
		emailVerified: true,
	});
	await db.insert(tables.userOrganization).values({
		id: "other-user-org-id",
		userId: "other-user-id",
		organizationId: "test-org-id",
		role: "developer",
		...budget,
	});
	await db.insert(tables.apiKey).values({
		id: "other-api-key-id",
		...hashApiKeyForStorage("other-api-key-token"),
		projectId: "test-project-id",
		description: "Other Developer Key",
		createdBy: "other-user-id",
	});
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
			...hashApiKeyForStorage("test-token"),
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

	test("POST /keys/api treats the playground description as a regular key", async () => {
		const res = await app.request("/keys/api", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Cookie: token,
			},
			body: JSON.stringify({
				description: "Auto-generated playground key",
				projectId: "test-project-id",
			}),
		});

		expect(res.status).toBe(200);
		expect((await res.json()).apiKey.kind).toBe("regular");
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
		expect(json.apiKeys.length).toBe(1);
		expect(json.apiKeys[0].description).toBe("Test API Key");
		expect(json.apiKeys[0].token).toBeUndefined();
		expect(json.apiKeys[0].tokenHash).toBeUndefined();
	});

	test("GET /keys/api returns the managed playground row", async () => {
		await db.insert(tables.apiKey).values({
			id: "playground-key",
			...hashApiKeyForStorage("playground-token"),
			projectId: "test-project-id",
			description: "Playground",
			kind: "playground",
			usage: "4",
			createdBy: "test-user-id",
		});

		const res = await app.request("/keys/api?projectId=test-project-id", {
			headers: { Cookie: token },
		});

		expect(res.status).toBe(200);
		const json = await res.json();
		const playgroundRows = json.apiKeys.filter(
			(key: { kind: string }) => key.kind === "playground",
		);
		expect(playgroundRows).toEqual([
			expect.objectContaining({
				id: "playground-key",
				description: "Playground",
				maskedToken: expect.stringContaining("playground"),
				usage: "4",
			}),
		]);
		expect(playgroundRows[0].token).toBeUndefined();
		expect(playgroundRows[0].tokenHash).toBeUndefined();
	});

	test("managed playground keys reject all mutation routes", async () => {
		await db.insert(tables.apiKey).values({
			id: "playground-key",
			...hashApiKeyForStorage("playground-token"),
			projectId: "test-project-id",
			description: "Playground",
			kind: "playground",
			createdBy: "test-user-id",
		});
		await db.insert(tables.apiKeyIamRule).values({
			id: "playground-rule",
			apiKeyId: "playground-key",
			ruleType: "allow_models",
			ruleValue: { models: ["openai/gpt-4o-mini"] },
		});

		const requests = [
			new Request("http://localhost/keys/api/playground-key", {
				method: "PATCH",
				headers: { "Content-Type": "application/json", Cookie: token },
				body: JSON.stringify({ status: "inactive" }),
			}),
			new Request("http://localhost/keys/api/playground-key/roll", {
				method: "POST",
				headers: { Cookie: token },
			}),
			new Request("http://localhost/keys/api/limit/playground-key", {
				method: "PATCH",
				headers: { "Content-Type": "application/json", Cookie: token },
				body: JSON.stringify({ usageLimit: "10" }),
			}),
			new Request("http://localhost/keys/api/playground-key/iam", {
				method: "POST",
				headers: { "Content-Type": "application/json", Cookie: token },
				body: JSON.stringify({
					ruleType: "allow_models",
					ruleValue: { models: ["openai/gpt-4o-mini"] },
				}),
			}),
			new Request(
				"http://localhost/keys/api/playground-key/iam/playground-rule",
				{
					method: "PATCH",
					headers: { "Content-Type": "application/json", Cookie: token },
					body: JSON.stringify({ status: "inactive" }),
				},
			),
			new Request(
				"http://localhost/keys/api/playground-key/iam/playground-rule",
				{
					method: "DELETE",
					headers: { Cookie: token },
				},
			),
			new Request("http://localhost/keys/api/playground-key", {
				method: "DELETE",
				headers: { Cookie: token },
			}),
		];

		for (const request of requests) {
			const response = await app.request(request);
			expect(response.status).toBe(403);
		}
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
		expect(platformKey?.tokenHash).toBe(
			getApiKeyFingerprint(json.platformKey.token),
		);
	});

	test("POST /keys/platform allows the playground key description", async () => {
		const res = await app.request("/keys/platform", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Cookie: token,
			},
			body: JSON.stringify({
				projectId: "test-project-id",
				description: "Auto-generated playground key",
			}),
		});

		expect(res.status).toBe(200);
		expect((await res.json()).platformKey.description).toBe(
			"Auto-generated playground key",
		);
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
			...hashApiKeyForStorage("sk_test_platform_secret"),
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
			...hashApiKeyForStorage("sk_test_platform_secret"),
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
			...hashApiKeyForStorage("sk_test_developer_platform_secret"),
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
		expect(json.apiKey.tokenHash).toBeUndefined();

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
		expect(json.apiKey.tokenHash).toBeUndefined();

		// Verify the DB was updated and metadata/stats are intact.
		const apiKey = await db.query.apiKey.findFirst({
			where: {
				id: {
					eq: "test-api-key-id",
				},
			},
		});
		expect(apiKey?.tokenHash).toBe(getApiKeyFingerprint(json.apiKey.token));
		expect(apiKey?.tokenMasked).not.toContain(json.apiKey.token);
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
		await waitForSwrMirrorWrites();
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

	test("POST /keys/api/{id}/iam busts the gateway's cached IAM rule lookups", async () => {
		// The gateway enforces IAM rules through a cached select (cdb) wrapped in
		// an SWR fallback mirror, both indexed by the api_key_iam_rule table (see
		// findActiveIamRules in apps/gateway/src/lib/cached-queries.ts). Creating
		// a rule through cdb must bust both layers so it applies immediately.
		//
		// A per-run unique API key keeps the cache keys (SWR key and Drizzle query
		// hash, which includes the bind params) from colliding with cached entries
		// left in Redis by earlier runs, which outlive deleteAll().
		const apiKeyId = `cache-test-api-key-${crypto.randomUUID()}`;
		await db.insert(tables.apiKey).values({
			id: apiKeyId,
			...hashApiKeyForStorage(`${apiKeyId}-token`),
			projectId: "test-project-id",
			description: "IAM Cache Test Key",
			createdBy: "test-user-id",
		});
		const readActiveIamRules = async () => {
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
		};

		// Prime both cache layers with the "no rules" result.
		expect(await readActiveIamRules()).toHaveLength(0);
		expect(
			await redisClient.get(SWR_PREFIX + `iamRules:${apiKeyId}`),
		).not.toBeNull();

		const res = await app.request(`/keys/api/${apiKeyId}/iam`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Cookie: token,
			},
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

	// Regression tests for GHSA-pjj8-5gpw-f42r: the rule mutation endpoints
	// authorized only the {id} API key while resolving the rule by {ruleId}
	// alone, letting any authenticated user tamper with other organizations'
	// IAM rules.
	describe("IAM rule tenant isolation", () => {
		beforeEach(async () => {
			// A victim organization the test user is NOT a member of, with its own
			// project, API key, and IAM rule.
			await db.insert(tables.organization).values({
				id: "victim-org-id",
				name: "Victim Organization",
				billingEmail: "victim@example.com",
			});
			await db.insert(tables.project).values({
				id: "victim-project-id",
				name: "Victim Project",
				organizationId: "victim-org-id",
			});
			await db.insert(tables.user).values({
				id: "victim-user-id",
				name: "Victim User",
				email: "victim-user@example.com",
				emailVerified: true,
			});
			await db.insert(tables.apiKey).values({
				id: "victim-api-key-id",
				...hashApiKeyForStorage("victim-api-key-token"),
				projectId: "victim-project-id",
				description: "Victim Key",
				createdBy: "victim-user-id",
			});
			await db.insert(tables.apiKeyIamRule).values({
				id: "victim-rule-id",
				apiKeyId: "victim-api-key-id",
				ruleType: "allow_models",
				ruleValue: { models: ["openai/gpt-4o-mini"] },
				status: "active",
			});
		});

		test("PATCH cannot update another organization's IAM rule", async () => {
			const res = await app.request(
				"/keys/api/test-api-key-id/iam/victim-rule-id",
				{
					method: "PATCH",
					headers: {
						"Content-Type": "application/json",
						Cookie: token,
					},
					body: JSON.stringify({ status: "inactive" }),
				},
			);
			expect(res.status).toBe(404);

			const rule = await db.query.apiKeyIamRule.findFirst({
				where: { id: { eq: "victim-rule-id" } },
			});
			expect(rule?.status).toBe("active");
		});

		test("DELETE cannot delete another organization's IAM rule", async () => {
			const res = await app.request(
				"/keys/api/test-api-key-id/iam/victim-rule-id",
				{
					method: "DELETE",
					headers: {
						Cookie: token,
					},
				},
			);
			expect(res.status).toBe(404);

			const rule = await db.query.apiKeyIamRule.findFirst({
				where: { id: { eq: "victim-rule-id" } },
			});
			expect(rule).toBeDefined();
		});

		test("PATCH and DELETE still work for a rule on the caller's own key", async () => {
			await db.insert(tables.apiKeyIamRule).values({
				id: "own-rule-id",
				apiKeyId: "test-api-key-id",
				ruleType: "allow_models",
				ruleValue: { models: ["openai/gpt-4o-mini"] },
				status: "active",
			});

			const patch = await app.request(
				"/keys/api/test-api-key-id/iam/own-rule-id",
				{
					method: "PATCH",
					headers: {
						"Content-Type": "application/json",
						Cookie: token,
					},
					body: JSON.stringify({ status: "inactive" }),
				},
			);
			expect(patch.status).toBe(200);
			const patched = await patch.json();
			expect(patched.rule.status).toBe("inactive");

			const del = await app.request(
				"/keys/api/test-api-key-id/iam/own-rule-id",
				{
					method: "DELETE",
					headers: {
						Cookie: token,
					},
				},
			);
			expect(del.status).toBe(200);

			const rule = await db.query.apiKeyIamRule.findFirst({
				where: { id: { eq: "own-rule-id" } },
			});
			expect(rule).toBeUndefined();
		});
	});

	test("GET /keys/api without projectId hides other members' keys from developers", async () => {
		await seedOtherMemberKey({});
		// Give the developer a credential account (same password as the admin
		// fixture) and sign in as them.
		await db.insert(tables.account).values({
			id: "other-account-id",
			providerId: "credential",
			accountId: "other-account-id",
			userId: "other-user-id",
			password:
				"c11ef27a7f9264be08db228ebb650888:a4d985a9c6bd98608237fd507534424950aa7fc255930d972242b81cbe78594f8568feb0d067e95ddf7be242ad3e9d013f695f4414fce68bfff091079f1dc460",
		});
		const auth = await app.request("/auth/sign-in/email", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				email: "other-developer@example.com",
				password: "admin@example.com1A",
			}),
		});
		expect(auth.status).toBe(200);
		const devToken = auth.headers.get("set-cookie")!;

		const res = await app.request("/keys/api", {
			headers: { Cookie: devToken },
		});
		expect(res.status).toBe(200);
		const json = await res.json();
		const ids = json.apiKeys.map((key: { id: string }) => key.id);
		expect(ids).toContain("other-api-key-id");
		expect(ids).not.toContain("test-api-key-id");
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
		expect(json.apiKey.tokenHash).toBeUndefined();

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
		expect(apiKey?.tokenHash).toBe(getApiKeyFingerprint(json.apiKey.token));
	});

	test("POST /keys/api rejects a limit above the member budget", async () => {
		await db
			.update(tables.userOrganization)
			.set({ usageLimit: "10" })
			.where(eq(tables.userOrganization.id, "test-user-org-id"));

		const res = await app.request("/keys/api", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Cookie: token,
			},
			body: JSON.stringify({
				description: "Over-budget key",
				projectId: "test-project-id",
				usageLimit: "50",
			}),
		});

		expect(res.status).toBe(400);
		const json = await res.json();
		expect(json.message).toMatch(/organization limit of \$10\.00/);

		const apiKey = await db.query.apiKey.findFirst({
			where: { description: { eq: "Over-budget key" } },
		});
		expect(apiKey).toBeUndefined();
	});

	test("POST /keys/api allows a limit at or below the member budget", async () => {
		await db
			.update(tables.userOrganization)
			.set({ usageLimit: "10" })
			.where(eq(tables.userOrganization.id, "test-user-org-id"));

		const res = await app.request("/keys/api", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Cookie: token,
			},
			body: JSON.stringify({
				description: "Within-budget key",
				projectId: "test-project-id",
				usageLimit: "10",
			}),
		});

		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.apiKey.usageLimit).toBe("10");
	});

	test("POST /keys/api enforces team and personal budgets independently", async () => {
		await db.insert(tables.organizationTeam).values({
			id: "key-budget-team",
			organizationId: "test-org-id",
			name: "Key Budget Team",
			periodUsageLimit: "5",
			periodUsageDurationValue: 1,
			periodUsageDurationUnit: "day",
		});
		await db.insert(tables.organizationTeamProject).values({
			teamId: "key-budget-team",
			projectId: "test-project-id",
		});
		await db
			.update(tables.userOrganization)
			.set({
				role: "developer",
				teamId: "key-budget-team",
				periodUsageLimit: "50",
				periodUsageDurationValue: 1,
				periodUsageDurationUnit: "week",
			})
			.where(eq(tables.userOrganization.id, "test-user-org-id"));
		await db.insert(tables.userProject).values({
			userOrganizationId: "test-user-org-id",
			projectId: "test-project-id",
		});

		const res = await app.request("/keys/api", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Cookie: token,
			},
			body: JSON.stringify({
				description: "Over team period budget",
				projectId: "test-project-id",
				periodUsageLimit: "10",
				periodUsageDurationValue: 1,
				periodUsageDurationUnit: "day",
			}),
		});

		expect(res.status).toBe(400);
		expect((await res.json()).message).toMatch(/organization limit/);
	});

	test("POST /keys/api uses the stricter team key count ceiling", async () => {
		await db.insert(tables.organizationTeam).values({
			id: "key-count-team",
			organizationId: "test-org-id",
			name: "Key Count Team",
			maxApiKeys: 1,
		});
		await db.insert(tables.organizationTeamProject).values({
			teamId: "key-count-team",
			projectId: "test-project-id",
		});
		await db
			.update(tables.userOrganization)
			.set({ role: "developer", teamId: "key-count-team", maxApiKeys: 4 })
			.where(eq(tables.userOrganization.id, "test-user-org-id"));
		await db.insert(tables.userProject).values({
			userOrganizationId: "test-user-org-id",
			projectId: "test-project-id",
		});

		const res = await app.request("/keys/api", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Cookie: token,
			},
			body: JSON.stringify({
				description: "Second team key",
				projectId: "test-project-id",
			}),
		});

		expect(res.status).toBe(400);
		expect((await res.json()).message).toMatch(/active API key/);
	});

	test("PATCH /keys/api/limit/{id} rejects a limit above the member budget", async () => {
		await db
			.update(tables.userOrganization)
			.set({ usageLimit: "10" })
			.where(eq(tables.userOrganization.id, "test-user-org-id"));

		const res = await app.request("/keys/api/limit/test-api-key-id", {
			method: "PATCH",
			headers: {
				"Content-Type": "application/json",
				Cookie: token,
			},
			body: JSON.stringify({ usageLimit: "50" }),
		});

		expect(res.status).toBe(400);
		const json = await res.json();
		expect(json.message).toMatch(/organization limit of \$10\.00/);
	});

	test("PATCH /keys/api/limit/{id} blames the key owner's budget", async () => {
		await seedOtherMemberKey({ usageLimit: "10" });

		const res = await app.request("/keys/api/limit/other-api-key-id", {
			method: "PATCH",
			headers: {
				"Content-Type": "application/json",
				Cookie: token,
			},
			body: JSON.stringify({ usageLimit: "50" }),
		});

		expect(res.status).toBe(400);
		const json = await res.json();
		expect(json.message).toMatch(/the key owner's limit of \$10\.00/);
		expect(json.message).toMatch(/Team page/);
	});

	test("GET /keys/api returns each key owner's effective budget", async () => {
		await seedOtherMemberKey({});
		await db
			.update(tables.organization)
			.set({
				defaultDeveloperPeriodUsageLimit: "500",
				defaultDeveloperPeriodUsageDurationValue: 1,
				defaultDeveloperPeriodUsageDurationUnit: "month",
			})
			.where(eq(tables.organization.id, "test-org-id"));

		const res = await app.request("/keys/api?projectId=test-project-id", {
			headers: { Cookie: token },
		});

		expect(res.status).toBe(200);
		const json = await res.json();
		const otherKey = json.apiKeys.find(
			(key: { id: string }) => key.id === "other-api-key-id",
		);
		// The developer inherits the org-wide default developer budget.
		expect(otherKey.ownerBudget).toEqual({
			usageLimit: null,
			periodUsageLimit: "500",
			periodUsageDurationValue: 1,
			periodUsageDurationUnit: "month",
		});
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
		expect(json.apiKey.tokenHash).toBeUndefined();

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

	test("POST /keys/api enforces the org-wide free-plan limit of 5", async () => {
		// beforeEach already created 1 active key; add 4 more to reach the free
		// org-wide cap of 5 active keys.
		for (let i = 2; i <= 5; i++) {
			await db.insert(tables.apiKey).values({
				id: `test-api-key-id-${i}`,
				...hashApiKeyForStorage(`test-token-${i}`),
				projectId: "test-project-id",
				description: `Test API Key ${i}`,
				status: "active",
				createdBy: "test-user-id",
			});
		}

		// Try to create the 6th API key, should fail
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
		expect(json.message).toContain(
			"Maximum 5 active API keys per organization",
		);
	});

	test("POST /keys/api respects the admin apiKeyLimit override", async () => {
		await db
			.update(tables.organization)
			.set({ apiKeyLimit: 2 })
			.where(eq(tables.organization.id, "test-org-id"));

		// beforeEach created 1 active key; add 1 more to reach the override of 2.
		await db.insert(tables.apiKey).values({
			id: "test-api-key-id-2",
			...hashApiKeyForStorage("test-token-2"),
			projectId: "test-project-id",
			description: "Test API Key 2",
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
				description: "Third API Key",
				projectId: "test-project-id",
				usageLimit: null,
			}),
		});

		expect(res.status).toBe(400);
		const json = await res.json();
		expect(json.message).toContain(
			"Maximum 2 active API keys per organization",
		);
	});
});
