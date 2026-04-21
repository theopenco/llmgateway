import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { redisClient, SWR_PREFIX } from "@llmgateway/cache";
import {
	cdb,
	db,
	eq,
	apiKey,
	apiKeyIamRule,
	organization,
	project,
	providerKey,
	user,
	userOrganization,
} from "@llmgateway/db";

import { getApiKeyFingerprint } from "./api-key-fingerprint.js";
import {
	findActiveIamRules,
	findActiveProviderKeys,
	findApiKeyByToken,
	findOrganizationById,
	findProjectById,
	findProviderKey,
	findProviderKeysByProviders,
	findUserFromOrganization,
} from "./cached-queries.js";

const testUserId = "test-user-swr";
const testOrgId = "test-org-swr";
const testZeroOrgId = "test-org-swr-zero";
const testProjectId = "test-project-swr";
const testApiKeyId = "test-api-key-swr";
const testApiKeyToken = "sk-test-swr-token";
const testProviderKeyOpenAi = "test-provider-key-swr-openai";
const testProviderKeyAnthropic = "test-provider-key-swr-anthropic";
const testIamRuleId = "test-iam-rule-swr";

async function flushDrizzleCache(): Promise<void> {
	const keys = await redisClient.keys("drizzle:cache:*");
	if (keys.length) {
		await redisClient.unlink(...keys);
	}
	const tableKeys = await redisClient.keys("drizzle:table_keys:*");
	if (tableKeys.length) {
		await redisClient.unlink(...tableKeys);
	}
}

async function flushSwrOnly(): Promise<void> {
	const keys = await redisClient.keys("swr:*");
	if (keys.length) {
		await redisClient.unlink(...keys);
	}
}

describe("cached-queries SWR integration", () => {
	beforeEach(async () => {
		vi.restoreAllMocks();

		// Clean relevant tables
		await db.delete(apiKeyIamRule);
		await db.delete(apiKey);
		await db.delete(providerKey);
		await db.delete(userOrganization);
		await db.delete(project);
		await db.delete(organization).where(eq(organization.id, testOrgId));
		await db.delete(organization).where(eq(organization.id, testZeroOrgId));
		await db.delete(user).where(eq(user.id, testUserId));

		// Flush redis so SWR + Drizzle caches are fresh
		await redisClient.flushdb();

		// Seed test data
		await db.insert(user).values({
			id: testUserId,
			name: "Test User SWR",
			email: "test-swr@example.com",
		});

		await db.insert(organization).values({
			id: testOrgId,
			name: "Test Organization SWR",
			billingEmail: "test-swr@example.com",
			plan: "pro",
			credits: "100.00",
		});

		await db.insert(organization).values({
			id: testZeroOrgId,
			name: "Test Organization SWR Zero",
			billingEmail: "test-swr-zero@example.com",
			plan: "pro",
			credits: "0",
		});

		await db.insert(userOrganization).values({
			id: "test-user-org-swr",
			userId: testUserId,
			organizationId: testOrgId,
		});

		await db.insert(project).values({
			id: testProjectId,
			name: "Test Project SWR",
			organizationId: testOrgId,
			mode: "api-keys",
		});

		await db.insert(apiKey).values({
			id: testApiKeyId,
			token: testApiKeyToken,
			projectId: testProjectId,
			description: "Test API Key for SWR testing",
			status: "active",
			createdBy: testUserId,
		});

		await db.insert(providerKey).values({
			id: testProviderKeyOpenAi,
			token: "swr-test-openai-token",
			provider: "openai",
			organizationId: testOrgId,
			status: "active",
		});

		await db.insert(providerKey).values({
			id: testProviderKeyAnthropic,
			token: "swr-test-anthropic-token",
			provider: "anthropic",
			organizationId: testOrgId,
			status: "active",
		});

		await db.insert(apiKeyIamRule).values({
			id: testIamRuleId,
			apiKeyId: testApiKeyId,
			ruleType: "allow_models",
			ruleValue: { models: ["gpt-4"] },
			status: "active",
		});
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		await db.delete(apiKeyIamRule);
		await db.delete(apiKey);
		await db.delete(providerKey);
		await db.delete(userOrganization);
		await db.delete(project);
		await db.delete(organization).where(eq(organization.id, testOrgId));
		await db.delete(organization).where(eq(organization.id, testZeroOrgId));
		await db.delete(user).where(eq(user.id, testUserId));
	});

	describe("prime writes SWR mirror", () => {
		it("findApiKeyByToken primes mirror at hashed-token key", async () => {
			const result = await findApiKeyByToken(testApiKeyToken);
			expect(result?.id).toBe(testApiKeyId);

			const mirror = await redisClient.get(
				`${SWR_PREFIX}apiKey:token:${getApiKeyFingerprint(testApiKeyToken)}`,
			);
			expect(mirror).not.toBeNull();
			const raw = await redisClient.get(
				`${SWR_PREFIX}apiKey:token:${testApiKeyToken}`,
			);
			expect(raw).toBeNull();
		});

		it("findProjectById primes mirror at project:{id}", async () => {
			const result = await findProjectById(testProjectId);
			expect(result?.id).toBe(testProjectId);

			const mirror = await redisClient.get(
				`${SWR_PREFIX}project:${testProjectId}`,
			);
			expect(mirror).not.toBeNull();
		});

		it("findOrganizationById primes mirror at org:{id}", async () => {
			const result = await findOrganizationById(testOrgId);
			expect(result?.id).toBe(testOrgId);

			const mirror = await redisClient.get(`${SWR_PREFIX}org:${testOrgId}`);
			expect(mirror).not.toBeNull();
		});

		it("findActiveIamRules primes mirror at iamRules:{apiKeyId}", async () => {
			const result = await findActiveIamRules(testApiKeyId);
			expect(result).toHaveLength(1);

			const mirror = await redisClient.get(
				`${SWR_PREFIX}iamRules:${testApiKeyId}`,
			);
			expect(mirror).not.toBeNull();
		});

		it("findProviderKey primes mirror at providerKey:{org}:{provider}", async () => {
			const result = await findProviderKey(testOrgId, "openai");
			expect(result).toBeDefined();

			const mirror = await redisClient.get(
				`${SWR_PREFIX}providerKey:${testOrgId}:openai`,
			);
			expect(mirror).not.toBeNull();
		});

		it("findActiveProviderKeys primes mirror at providerKey:active:{org}", async () => {
			const result = await findActiveProviderKeys(testOrgId);
			expect(result.length).toBeGreaterThan(0);

			const mirror = await redisClient.get(
				`${SWR_PREFIX}providerKey:active:${testOrgId}`,
			);
			expect(mirror).not.toBeNull();
		});

		it("findProviderKeysByProviders primes mirror with sorted provider key", async () => {
			const result = await findProviderKeysByProviders(testOrgId, [
				"openai",
				"anthropic",
			]);
			expect(result).toHaveLength(2);

			const mirror = await redisClient.get(
				`${SWR_PREFIX}providerKey:byProviders:${testOrgId}:anthropic,openai`,
			);
			expect(mirror).not.toBeNull();
		});

		it("findUserFromOrganization primes mirror at userFromOrg:{org}", async () => {
			const result = await findUserFromOrganization(testOrgId);
			expect(result?.user.id).toBe(testUserId);

			const mirror = await redisClient.get(
				`${SWR_PREFIX}userFromOrg:${testOrgId}`,
			);
			expect(mirror).not.toBeNull();
		});
	});

	describe("fallback when DB fails", () => {
		it("returns SWR mirror when Drizzle cache is flushed and DB errors", async () => {
			await findApiKeyByToken(testApiKeyToken);

			// Expire Drizzle cache keys only, keeping SWR mirror.
			await flushDrizzleCache();

			const selectSpy = vi.spyOn(cdb, "select").mockImplementation(() => {
				throw new Error("postgres unavailable");
			});

			const result = await findApiKeyByToken(testApiKeyToken);
			expect(result?.id).toBe(testApiKeyId);

			selectSpy.mockRestore();
		});

		it("throws when SWR mirror is gone and DB errors", async () => {
			await findApiKeyByToken(testApiKeyToken);
			await flushDrizzleCache();
			await flushSwrOnly();

			const selectSpy = vi.spyOn(cdb, "select").mockImplementation(() => {
				throw new Error("postgres unavailable");
			});

			await expect(findApiKeyByToken(testApiKeyToken)).rejects.toThrow(
				"postgres unavailable",
			);

			selectSpy.mockRestore();
		});

		it("zero-credit org still resolves via SWR when DB is down", async () => {
			const primed = await findOrganizationById(testZeroOrgId);
			expect(primed?.id).toBe(testZeroOrgId);

			await flushDrizzleCache();

			const selectSpy = vi.spyOn(cdb, "select").mockImplementation(() => {
				throw new Error("postgres unavailable");
			});
			const selectUncachedSpy = vi
				.spyOn(db, "select")
				.mockImplementation(() => {
					throw new Error("postgres unavailable");
				});

			const result = await findOrganizationById(testZeroOrgId);
			expect(result?.id).toBe(testZeroOrgId);

			selectSpy.mockRestore();
			selectUncachedSpy.mockRestore();
		});
	});

	describe("mutation invalidates SWR mirror", () => {
		it("updating a row via cdb clears SWR mirrors for that table", async () => {
			await findProjectById(testProjectId);
			expect(
				await redisClient.get(`${SWR_PREFIX}project:${testProjectId}`),
			).not.toBeNull();

			await cdb
				.update(project)
				.set({ name: "Renamed Project" })
				.where(eq(project.id, testProjectId));

			expect(
				await redisClient.get(`${SWR_PREFIX}project:${testProjectId}`),
			).toBeNull();
		});
	});
});
