import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { encryptProviderKeyForStorage } from "@llmgateway/actions";
import { redisClient } from "@llmgateway/cache";
import {
	cdb,
	db,
	eq,
	apiKey,
	apiKeyIamRule,
	customModel,
	endCustomer,
	endUserSession,
	organization,
	project,
	providerKey,
	user,
	userOrganization,
	wallet,
} from "@llmgateway/db";
import {
	hashApiKeyForStorage,
	hashTokenForStorage,
} from "@llmgateway/shared/api-key-hash";

import {
	reportTrackedKeyError,
	reportTrackedKeySuccess,
	resetKeyHealth,
} from "./api-key-health.js";
import {
	findApiKeyByToken,
	findProjectById,
	findOrganizationById,
	findCustomProviderKey,
	findActiveCustomModels,
	findProviderKey,
	findActiveProviderKeys,
	findProviderKeysByProviders,
	findActiveIamRules,
	findUserFromOrganization,
} from "./cached-queries.js";

/**
 * These tests verify that all cached query functions return correct data.
 *
 * IMPORTANT: Cache resilience (proving queries work from Redis when Postgres is down)
 * is tested in packages/db/src/cdb-resilience.spec.ts. Those tests prove that the
 * select builder pattern (db.select().from()) works with Drizzle's cache layer.
 *
 * The functions in cached-queries.ts all use the select builder pattern,
 * which is the only pattern that goes through Drizzle's cache. The relational
 * query API (db.query.table.findFirst()) does NOT use the cache.
 */
describe("Cached Queries - Gateway Database Access", () => {
	const testUserId = "test-user-cached-queries";
	const testOrgId = "test-org-cached-queries";
	const testProjectId = "test-project-cached-queries";
	const testApiKeyId = "test-api-key-cached-queries";
	const testApiKeyToken = "sk-test-cached-queries-token";
	const testProviderKeyId = "test-provider-key-cached-queries";
	const testIamRuleId = "test-iam-rule-cached-queries";

	beforeEach(async () => {
		resetKeyHealth();

		// Clean up test data using regular db
		await db.delete(apiKeyIamRule);
		await db.delete(apiKey);
		await db.delete(providerKey);
		await db.delete(userOrganization);
		await db.delete(project);
		await db.delete(organization);
		await db.delete(user);

		// Insert test data
		await db.insert(user).values({
			id: testUserId,
			name: "Test User",
			email: "test-cached-queries@example.com",
		});

		await db.insert(organization).values({
			id: testOrgId,
			name: "Test Organization",
			billingEmail: "test-cached-queries@example.com",
			plan: "pro",
			credits: "100.00",
		});

		await db.insert(userOrganization).values({
			id: "test-user-org-cached-queries",
			userId: testUserId,
			organizationId: testOrgId,
		});

		await db.insert(project).values({
			id: testProjectId,
			name: "Test Project",
			organizationId: testOrgId,
			mode: "hybrid",
		});

		await db.insert(apiKey).values({
			id: testApiKeyId,
			...hashApiKeyForStorage(testApiKeyToken),
			projectId: testProjectId,
			description: "Test API Key for cached queries testing",
			status: "active",
			createdBy: testUserId,
		});

		await db.insert(providerKey).values({
			id: testProviderKeyId,
			...encryptProviderKeyForStorage(
				"test-provider-token",
				testProviderKeyId,
				testOrgId,
			),
			provider: "openai",
			organizationId: testOrgId,
			status: "active",
		});

		await db.insert(providerKey).values({
			id: "test-provider-key-cached-queries-2",
			...encryptProviderKeyForStorage(
				"test-provider-token-2",
				"test-provider-key-cached-queries-2",
				testOrgId,
			),
			provider: "openai",
			organizationId: testOrgId,
			status: "active",
		});

		await db.insert(providerKey).values({
			id: "test-custom-provider-key",
			...encryptProviderKeyForStorage(
				"test-custom-token",
				"test-custom-provider-key",
				testOrgId,
			),
			provider: "custom",
			name: "my-custom-provider",
			baseUrl: "https://api.custom.example.com",
			organizationId: testOrgId,
			status: "active",
		});

		await db.insert(customModel).values([
			{
				id: "test-active-custom-model",
				providerKeyId: "test-custom-provider-key",
				organizationId: testOrgId,
				modelName: "claude-haiku-4-5",
				inputPrice: "1e-6",
				outputPrice: "2e-6",
			},
			{
				id: "test-inactive-custom-model",
				providerKeyId: "test-custom-provider-key",
				organizationId: testOrgId,
				modelName: "inactive-model",
				status: "inactive",
			},
		]);

		await db.insert(apiKeyIamRule).values({
			id: testIamRuleId,
			apiKeyId: testApiKeyId,
			ruleType: "allow_models",
			ruleValue: { models: ["gpt-4", "gpt-3.5-turbo"] },
			status: "active",
		});
	});

	afterEach(async () => {
		resetKeyHealth();

		// Clean up test data
		await db.delete(apiKeyIamRule);
		await db.delete(apiKey);
		await db.delete(providerKey);
		await db.delete(userOrganization);
		await db.delete(project);
		await db.delete(organization);
		await db.delete(user);
	});

	describe("findApiKeyByToken", () => {
		async function insertEndUserSession(tokenValues: { tokenHash: string }) {
			await db.insert(endCustomer).values({
				id: "test-end-customer-cached-queries",
				organizationId: testOrgId,
				projectId: testProjectId,
				externalId: "external-user",
			});
			await db.insert(wallet).values({
				id: "test-wallet-cached-queries",
				endCustomerId: "test-end-customer-cached-queries",
				organizationId: testOrgId,
				projectId: testProjectId,
			});
			await db.insert(apiKey).values({
				id: "test-end-user-key-cached-queries",
				...hashApiKeyForStorage("euck_internal-principal"),
				projectId: testProjectId,
				description: "Embedded end user",
				keyType: "end_user_customer",
				endCustomerWalletId: "test-wallet-cached-queries",
				createdBy: testUserId,
			});
			await db.insert(endUserSession).values({
				id: "test-end-user-session-cached-queries",
				...tokenValues,
				organizationId: testOrgId,
				projectId: testProjectId,
				endCustomerId: "test-end-customer-cached-queries",
				walletId: "test-wallet-cached-queries",
				createdBy: testUserId,
				expiresAt: new Date(Date.now() + 60_000),
			});
		}

		it("should find API key by token", async () => {
			const result = await findApiKeyByToken(testApiKeyToken);

			expect(result).toBeDefined();
			expect(result?.id).toBe(testApiKeyId);
			expect(result?.tokenHash).toBe(
				hashApiKeyForStorage(testApiKeyToken).tokenHash,
			);
			expect(result?.status).toBe("active");
		});

		it("should return undefined for non-existent token", async () => {
			const result = await findApiKeyByToken("sk-nonexistent");

			expect(result).toBeUndefined();
		});

		it("should find a hash-only API key by token", async () => {
			const hashedToken = "sk-test-hashed-cached-queries-token";
			await db.insert(apiKey).values({
				id: "test-hashed-api-key-cached-queries",
				...hashApiKeyForStorage(hashedToken),
				projectId: testProjectId,
				description: "Hashed API Key",
				status: "active",
				createdBy: testUserId,
			});

			const result = await findApiKeyByToken(hashedToken);

			expect(result?.id).toBe("test-hashed-api-key-cached-queries");
			expect(result?.tokenHash).toBe(
				hashApiKeyForStorage(hashedToken).tokenHash,
			);
		});

		it("should return undefined for platform secret tokens", async () => {
			const platformSecretToken = "sk-test-platform-secret-cached-queries";
			await db.insert(apiKey).values({
				id: "test-platform-secret-cached-queries",
				...hashApiKeyForStorage(platformSecretToken),
				projectId: testProjectId,
				description: "Test Platform Secret",
				status: "active",
				createdBy: testUserId,
				keyType: "platform_secret",
			});

			const result = await findApiKeyByToken(platformSecretToken);

			expect(result).toBeUndefined();
		});

		it("finds a hash-only embeddable session token", async () => {
			const token = "es_hash-only-cached-queries";
			await insertEndUserSession(hashTokenForStorage(token));

			const result = await findApiKeyByToken(token);

			expect(result?.id).toBe("test-end-user-key-cached-queries");
			expect(result?.endUserSession?.id).toBe(
				"test-end-user-session-cached-queries",
			);
		});
	});

	describe("findProjectById", () => {
		it("should find project by ID", async () => {
			const result = await findProjectById(testProjectId);

			expect(result).toBeDefined();
			expect(result?.id).toBe(testProjectId);
			expect(result?.name).toBe("Test Project");
			expect(result?.organizationId).toBe(testOrgId);
		});

		it("should return undefined for non-existent ID", async () => {
			const result = await findProjectById("nonexistent-id");

			expect(result).toBeUndefined();
		});
	});

	describe("findOrganizationById", () => {
		it("should find organization by ID", async () => {
			const result = await findOrganizationById(testOrgId);

			expect(result).toBeDefined();
			expect(result?.id).toBe(testOrgId);
			expect(result?.name).toBe("Test Organization");
			expect(result?.plan).toBe("pro");
		});

		it("should return undefined for non-existent ID", async () => {
			const result = await findOrganizationById("nonexistent-id");

			expect(result).toBeUndefined();
		});
	});

	describe("findCustomProviderKey", () => {
		it("should find custom provider key by organization and name", async () => {
			const result = await findCustomProviderKey(
				testOrgId,
				"my-custom-provider",
			);

			expect(result).toBeDefined();
			expect(result?.provider).toBe("custom");
			expect(result?.name).toBe("my-custom-provider");
			expect(result?.organizationId).toBe(testOrgId);
		});

		it("should return undefined for non-existent custom provider", async () => {
			const result = await findCustomProviderKey(testOrgId, "nonexistent");

			expect(result).toBeUndefined();
		});
	});

	describe("findActiveCustomModels", () => {
		it("finds active custom models for an organization", async () => {
			const result = await findActiveCustomModels(testOrgId);

			expect(result.map((model) => model.id)).toEqual([
				"test-active-custom-model",
			]);
		});

		it("returns an empty array for another organization", async () => {
			expect(await findActiveCustomModels("nonexistent-org")).toEqual([]);
		});
	});

	describe("findProviderKey", () => {
		it("should find provider key by organization and provider", async () => {
			const result = await findProviderKey(testOrgId, "openai");

			expect(result).toBeDefined();
			expect(result?.provider).toBe("openai");
			expect(result?.organizationId).toBe(testOrgId);
			expect(result?.status).toBe("active");
		});

		it("should always prefer the first provider key", async () => {
			const requestOne = await findProviderKey(
				testOrgId,
				"openai",
				"request-one",
			);
			const requestOneRepeat = await findProviderKey(
				testOrgId,
				"openai",
				"request-one",
			);
			const requestTwo = await findProviderKey(
				testOrgId,
				"openai",
				"request-two",
			);

			expect(requestOne?.id).toBe(requestOneRepeat?.id);
			expect(requestOne?.id).toBe(testProviderKeyId);
			expect(requestTwo?.id).toBe(testProviderKeyId);
		});

		it("should fail over when the primary key becomes unhealthy", async () => {
			reportTrackedKeyError(testProviderKeyId, 500);
			reportTrackedKeyError(testProviderKeyId, 500);
			reportTrackedKeyError(testProviderKeyId, 500);

			const result = await findProviderKey(testOrgId, "openai");

			expect(result?.id).toBe("test-provider-key-cached-queries-2");
		});

		it("should fail over when a later key has materially better uptime", async () => {
			reportTrackedKeySuccess(testProviderKeyId);
			reportTrackedKeyError(testProviderKeyId, 500);
			reportTrackedKeySuccess(testProviderKeyId);
			reportTrackedKeyError(testProviderKeyId, 500);

			for (let i = 0; i < 4; i++) {
				reportTrackedKeySuccess("test-provider-key-cached-queries-2");
			}

			const result = await findProviderKey(testOrgId, "openai");

			expect(result?.id).toBe("test-provider-key-cached-queries-2");
		});

		it("should keep tracked key health isolated per model scope", async () => {
			reportTrackedKeyError(testProviderKeyId, 500, undefined, "gpt-4");
			reportTrackedKeyError(testProviderKeyId, 500, undefined, "gpt-4");
			reportTrackedKeyError(testProviderKeyId, 500, undefined, "gpt-4");

			const gpt4Selection = await findProviderKey(testOrgId, "openai", "gpt-4");
			const claudeSelection = await findProviderKey(
				testOrgId,
				"openai",
				"claude-3-5-sonnet",
			);

			expect(gpt4Selection?.id).toBe("test-provider-key-cached-queries-2");
			expect(claudeSelection?.id).toBe(testProviderKeyId);
		});

		it("should select the next provider key when the current one is excluded", async () => {
			const result = await findProviderKey(
				testOrgId,
				"openai",
				"request-retry",
				new Set([testProviderKeyId]),
			);

			expect(result?.id).toBe("test-provider-key-cached-queries-2");
		});

		it("should return undefined for non-existent provider", async () => {
			const result = await findProviderKey(testOrgId, "nonexistent");

			expect(result).toBeUndefined();
		});
	});

	/**
	 * Order is what defines the primary key: selectProviderKeyWithFailover
	 * treats index 0 of the query result as primary. Before sortOrder existed
	 * that just meant "oldest", so an organization could not promote a key.
	 */
	describe("findProviderKey - manual order", () => {
		// This file seeds through the plain client, which does not invalidate the
		// cache, while these cases mutate through cdb, which does. Without a
		// flush a previous case's ordered result survives the reseed and leaks
		// into the next one.
		beforeEach(async () => {
			await redisClient.flushdb();
		});

		async function setOrder(entries: Record<string, number | null>) {
			for (const [id, value] of Object.entries(entries)) {
				await cdb
					.update(providerKey)
					.set({ sortOrder: value })
					.where(eq(providerKey.id, id));
			}
		}

		it("prefers the manually ordered key over the older one", async () => {
			await setOrder({
				"test-provider-key-cached-queries-2": 0,
				[testProviderKeyId]: 1,
			});

			const result = await findProviderKey(testOrgId, "openai");

			expect(result?.id).toBe("test-provider-key-cached-queries-2");
		});

		it("falls back to createdAt order when nothing is positioned", async () => {
			// Every row NULL is the post-migration state, and must behave exactly
			// as it did before the column existed.
			const result = await findProviderKey(testOrgId, "openai");

			expect(result?.id).toBe(testProviderKeyId);
		});

		it("sorts an unpositioned key after every positioned one", async () => {
			// Guards the nullable-no-default choice: a `default(0)` column would
			// tie this key with position 0 and slot it second instead of last.
			await db.insert(providerKey).values({
				id: "test-provider-key-cached-queries-3",
				...encryptProviderKeyForStorage(
					"test-provider-token-3",
					"test-provider-key-cached-queries-3",
					testOrgId,
				),
				provider: "openai",
				organizationId: testOrgId,
				status: "active",
			});
			await setOrder({
				[testProviderKeyId]: 0,
				"test-provider-key-cached-queries-2": 1,
			});

			const ordered = await findActiveProviderKeys(testOrgId);
			const openaiIds = ordered
				.filter((key) => key.provider === "openai")
				.map((key) => key.id);

			expect(openaiIds).toEqual([
				testProviderKeyId,
				"test-provider-key-cached-queries-2",
				"test-provider-key-cached-queries-3",
			]);
		});

		it("still fails over when the manual primary is unhealthy", async () => {
			await setOrder({
				"test-provider-key-cached-queries-2": 0,
				[testProviderKeyId]: 1,
			});
			reportTrackedKeyError("test-provider-key-cached-queries-2", 500);
			reportTrackedKeyError("test-provider-key-cached-queries-2", 500);
			reportTrackedKeyError("test-provider-key-cached-queries-2", 500);

			const result = await findProviderKey(testOrgId, "openai");

			expect(result?.id).toBe(testProviderKeyId);
		});

		it("still fails over when a later key has materially better uptime", async () => {
			// The uptime override is a deliberate product decision: manual order
			// picks the primary, health still wins.
			await setOrder({
				"test-provider-key-cached-queries-2": 0,
				[testProviderKeyId]: 1,
			});
			reportTrackedKeySuccess("test-provider-key-cached-queries-2");
			reportTrackedKeyError("test-provider-key-cached-queries-2", 500);
			reportTrackedKeySuccess("test-provider-key-cached-queries-2");
			reportTrackedKeyError("test-provider-key-cached-queries-2", 500);
			for (let i = 0; i < 4; i++) {
				reportTrackedKeySuccess(testProviderKeyId);
			}

			const result = await findProviderKey(testOrgId, "openai");

			expect(result?.id).toBe(testProviderKeyId);
		});

		it("returns manual order from the raw list queries", async () => {
			await setOrder({
				"test-provider-key-cached-queries-2": 0,
				[testProviderKeyId]: 1,
			});

			const byProviders = await findProviderKeysByProviders(testOrgId, [
				"openai",
			]);

			expect(byProviders.map((key) => key.id)).toEqual([
				"test-provider-key-cached-queries-2",
				testProviderKeyId,
			]);
		});
	});

	describe("findActiveProviderKeys", () => {
		it("should find all active provider keys for organization", async () => {
			const result = await findActiveProviderKeys(testOrgId);

			expect(result).toHaveLength(3); // two openai keys and one custom
			expect(result.every((k) => k.status === "active")).toBe(true);
			expect(result.every((k) => k.organizationId === testOrgId)).toBe(true);
		});

		it("should return empty array for organization with no provider keys", async () => {
			const result = await findActiveProviderKeys("nonexistent-org");

			expect(result).toHaveLength(0);
		});
	});

	describe("findProviderKeysByProviders", () => {
		it("should find provider keys for specific providers", async () => {
			const result = await findProviderKeysByProviders(testOrgId, ["openai"]);

			expect(result).toHaveLength(2);
			expect(result[0]?.provider).toBe("openai");
		});

		it("should return empty array for empty providers list", async () => {
			const result = await findProviderKeysByProviders(testOrgId, []);

			expect(result).toHaveLength(0);
		});

		it("should find multiple provider keys", async () => {
			const result = await findProviderKeysByProviders(testOrgId, [
				"openai",
				"custom",
			]);

			expect(result).toHaveLength(3);
		});
	});

	describe("findActiveIamRules", () => {
		it("should find active IAM rules for API key", async () => {
			const result = await findActiveIamRules(testApiKeyId);

			expect(result).toHaveLength(1);
			expect(result[0]?.id).toBe(testIamRuleId);
			expect(result[0]?.ruleType).toBe("allow_models");
			expect(result[0]?.status).toBe("active");
		});

		it("should return empty array for API key with no rules", async () => {
			const result = await findActiveIamRules("nonexistent-api-key");

			expect(result).toHaveLength(0);
		});
	});

	describe("findUserFromOrganization", () => {
		it("should find user from organization via join", async () => {
			const result = await findUserFromOrganization(testOrgId);

			expect(result).toBeDefined();
			expect(result?.user.id).toBe(testUserId);
			expect(result?.user.email).toBe("test-cached-queries@example.com");
			expect(result?.userOrganization.organizationId).toBe(testOrgId);
		});

		it("should return undefined for organization with no users", async () => {
			const result = await findUserFromOrganization("nonexistent-org");

			expect(result).toBeUndefined();
		});
	});
});
