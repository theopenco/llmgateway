import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	redisClient,
	SWR_PREFIX,
	waitForSwrMirrorWrites,
} from "@llmgateway/cache";
import {
	cdb,
	db,
	eq,
	apiKey,
	apiKeyIamRule,
	customModel,
	discount,
	organization,
	project,
	providerKey,
	providerKeyAllowsModel,
	routingScoreMultiplier,
	user,
	userOrganization,
} from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

import { getApiKeyFingerprints } from "./api-key-fingerprint.js";
import {
	findActiveIamRules,
	findActiveCustomModels,
	findActiveProviderKeys,
	findApiKeyByToken,
	findEffectiveDiscount,
	findManagedProviderAvailability,
	findOrganizationById,
	findProjectById,
	findProviderKey,
	findProviderKeysByProviders,
	findEffectiveRoutingScoreMultiplier,
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
const testCustomProviderKey = "test-provider-key-swr-custom";
const testCustomModelId = "test-custom-model-swr";
const testIamRuleId = "test-iam-rule-swr";
const testDiscountId = "test-discount-swr";
const testRoutingScoreMultiplierId = "test-routing-score-multiplier-swr";
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

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
		await waitForSwrMirrorWrites();

		// Clean relevant tables
		await db.delete(apiKeyIamRule);
		await db.delete(apiKey);
		await db.delete(providerKey);
		await db.delete(discount).where(eq(discount.id, testDiscountId));
		await db
			.delete(routingScoreMultiplier)
			.where(eq(routingScoreMultiplier.id, testRoutingScoreMultiplierId));
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

		await db.insert(providerKey).values({
			id: testCustomProviderKey,
			token: "swr-test-custom-token",
			provider: "custom",
			name: "swr-custom-provider",
			baseUrl: "https://custom.example.com",
			organizationId: testOrgId,
			status: "active",
		});

		await db.insert(customModel).values({
			id: testCustomModelId,
			providerKeyId: testCustomProviderKey,
			organizationId: testOrgId,
			modelName: "swr-custom-model",
			inputPrice: "1e-6",
			outputPrice: "2e-6",
		});

		await db.insert(apiKeyIamRule).values({
			id: testIamRuleId,
			apiKeyId: testApiKeyId,
			ruleType: "allow_models",
			ruleValue: { models: ["gpt-4"] },
			status: "active",
		});

		await db.insert(discount).values({
			id: testDiscountId,
			organizationId: testOrgId,
			provider: "openai",
			model: "gpt-4",
			discountPercent: "0.25",
			reason: "SWR test discount",
			// Non-null future expiry so the JS expiry filter has a value to evaluate
			// (exercises the active-discount path, including on a Drizzle cache hit).
			expiresAt: new Date(Date.now() + ONE_YEAR_MS),
		});

		await db.insert(routingScoreMultiplier).values({
			id: testRoutingScoreMultiplierId,
			provider: "openai",
			model: "gpt-4",
			scoreMultiplier: "-0.2",
			reason: "SWR test routing adjustment",
			expiresAt: new Date(Date.now() + ONE_YEAR_MS),
		});
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
		await waitForSwrMirrorWrites();
		await db.delete(apiKeyIamRule);
		await db.delete(apiKey);
		await db.delete(providerKey);
		await db.delete(discount).where(eq(discount.id, testDiscountId));
		await db
			.delete(routingScoreMultiplier)
			.where(eq(routingScoreMultiplier.id, testRoutingScoreMultiplierId));
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
			await waitForSwrMirrorWrites();

			const mirror = await redisClient.get(
				`${SWR_PREFIX}apiKey:token:${getApiKeyFingerprints(testApiKeyToken).join(":")}`,
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
			await waitForSwrMirrorWrites();

			const mirror = await redisClient.get(
				`${SWR_PREFIX}project:${testProjectId}`,
			);
			expect(mirror).not.toBeNull();
		});

		it("findOrganizationById primes mirror at org:{id}", async () => {
			const result = await findOrganizationById(testOrgId);
			expect(result?.id).toBe(testOrgId);
			await waitForSwrMirrorWrites();

			const mirror = await redisClient.get(`${SWR_PREFIX}org:${testOrgId}`);
			expect(mirror).not.toBeNull();
		});

		it("findActiveIamRules primes mirror at iamRules:{apiKeyId}", async () => {
			const result = await findActiveIamRules(testApiKeyId);
			expect(result).toHaveLength(1);
			await waitForSwrMirrorWrites();

			const mirror = await redisClient.get(
				`${SWR_PREFIX}iamRules:${testApiKeyId}`,
			);
			expect(mirror).not.toBeNull();
		});

		it("findProviderKey primes mirror at providerKey:{org}:{provider}", async () => {
			const result = await findProviderKey(testOrgId, "openai");
			expect(result).toBeDefined();
			await waitForSwrMirrorWrites();

			const mirror = await redisClient.get(
				`${SWR_PREFIX}providerKey:${testOrgId}:openai`,
			);
			expect(mirror).not.toBeNull();
		});

		it("findActiveProviderKeys primes mirror at providerKey:active:{org}", async () => {
			const result = await findActiveProviderKeys(testOrgId);
			expect(result.length).toBeGreaterThan(0);
			await waitForSwrMirrorWrites();

			const mirror = await redisClient.get(
				`${SWR_PREFIX}providerKey:active:${testOrgId}`,
			);
			expect(mirror).not.toBeNull();
		});

		it("findActiveCustomModels primes mirror at customModel:active:{org}", async () => {
			const result = await findActiveCustomModels(testOrgId);
			expect(result).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ id: testCustomModelId }),
				]),
			);
			await waitForSwrMirrorWrites();

			const mirror = await redisClient.get(
				`${SWR_PREFIX}customModel:active:${testOrgId}`,
			);
			expect(mirror).not.toBeNull();
		});

		it("findProviderKeysByProviders primes mirror with sorted provider key", async () => {
			const result = await findProviderKeysByProviders(testOrgId, [
				"openai",
				"anthropic",
			]);
			expect(result).toHaveLength(2);
			await waitForSwrMirrorWrites();

			const mirror = await redisClient.get(
				`${SWR_PREFIX}providerKey:byProviders:${testOrgId}:anthropic,openai`,
			);
			expect(mirror).not.toBeNull();
		});

		it("findUserFromOrganization primes mirror at userFromOrg:{org}", async () => {
			const result = await findUserFromOrganization(testOrgId);
			expect(result?.user.id).toBe(testUserId);
			await waitForSwrMirrorWrites();

			const mirror = await redisClient.get(
				`${SWR_PREFIX}userFromOrg:${testOrgId}`,
			);
			expect(mirror).not.toBeNull();
		});

		it("findEffectiveDiscount primes mirror at discount:{org}:{provider}:{model}", async () => {
			const result = await findEffectiveDiscount(testOrgId, "openai", "gpt-4");
			expect(result.discount).toBe("0.25");
			expect(result.source).toBe("org_provider_model");
			await waitForSwrMirrorWrites();

			const mirror = await redisClient.get(
				`${SWR_PREFIX}discount:${testOrgId}:openai:gpt-4`,
			);
			expect(mirror).not.toBeNull();
		});

		it("findEffectiveDiscount resolves an expiring discount on a Drizzle cache hit", async () => {
			// First call populates the Drizzle cache.
			const first = await findEffectiveDiscount(testOrgId, "openai", "gpt-4");
			expect(first.discount).toBe("0.25");
			await waitForSwrMirrorWrites();

			// Drop the SWR mirror so the next call can't fall back to it — it must
			// resolve through the Drizzle cache and apply the JS expiry filter to the
			// cached row (whose expiresAt is non-null) without erroring.
			await flushSwrOnly();

			const second = await findEffectiveDiscount(testOrgId, "openai", "gpt-4");
			expect(second.discount).toBe("0.25");
			expect(second.source).toBe("org_provider_model");
		});

		it("findEffectiveRoutingScoreMultiplier primes its SWR mirror", async () => {
			const result = await findEffectiveRoutingScoreMultiplier(
				"openai",
				"gpt-4",
			);
			expect(result.scoreMultiplier).toBe("-0.2");
			expect(result.source).toBe("provider_model");
			await waitForSwrMirrorWrites();

			const mirror = await redisClient.get(
				`${SWR_PREFIX}routingScoreMultiplier:openai:gpt-4`,
			);
			expect(mirror).not.toBeNull();
		});
	});

	describe("fallback when DB fails", () => {
		it("does not use a mirror after its hash secret is retired", async () => {
			const retiredToken = "sk-retired-secret-token";
			vi.stubEnv("GATEWAY_API_KEY_HASH_SECRET", "retired-secret");
			await db.insert(apiKey).values({
				id: "test-retired-secret-key",
				...hashApiKeyForStorage(retiredToken),
				projectId: testProjectId,
				description: "Retired secret key",
				status: "active",
				createdBy: testUserId,
			});

			vi.stubEnv(
				"GATEWAY_API_KEY_HASH_SECRET",
				"current-secret,retired-secret",
			);
			expect((await findApiKeyByToken(retiredToken))?.id).toBe(
				"test-retired-secret-key",
			);
			await waitForSwrMirrorWrites();
			await flushDrizzleCache();

			vi.stubEnv("GATEWAY_API_KEY_HASH_SECRET", "current-secret");
			const selectSpy = vi.spyOn(cdb, "select").mockImplementation(() => {
				throw new Error("postgres unavailable");
			});

			await expect(findApiKeyByToken(retiredToken)).rejects.toThrow(
				"postgres unavailable",
			);
			selectSpy.mockRestore();
		});

		it("returns SWR mirror when Drizzle cache is flushed and DB errors", async () => {
			await findApiKeyByToken(testApiKeyToken);
			await waitForSwrMirrorWrites();

			// Expire Drizzle cache keys only, keeping SWR mirror.
			await flushDrizzleCache();

			const selectSpy = vi.spyOn(cdb, "select").mockImplementation(() => {
				throw new Error("postgres unavailable");
			});

			const result = await findApiKeyByToken(testApiKeyToken);
			expect(result?.id).toBe(testApiKeyId);

			selectSpy.mockRestore();
		});

		it("model-restricted managed scopes survive a DB outage via SWR", async () => {
			await db.insert(providerKey).values({
				id: "swr-managed-restricted",
				token: "swr-managed-restricted-token",
				provider: "openai",
				managed: true,
				organizationId: null,
				status: "active",
				allowedModels: ["special-model"],
			});

			// Prime once — the per-model narrowing happens in memory after the
			// cached row fetch, so every model shares the same mirror entry.
			expect(
				(await findManagedProviderAvailability(undefined, "special-model"))
					.usable,
			).toContain("openai");
			await waitForSwrMirrorWrites();
			await flushDrizzleCache();

			const selectSpy = vi.spyOn(cdb, "select").mockImplementation(() => {
				throw new Error("postgres unavailable");
			});

			// The mirrored rows carry allowedModels (a text[] round-tripped through
			// JSON), so the restriction keeps filtering during the outage instead
			// of failing open or erroring.
			expect(
				(await findManagedProviderAvailability(undefined, "special-model"))
					.usable,
			).toContain("openai");
			expect(
				(await findManagedProviderAvailability(undefined, "some-other-model"))
					.usable,
			).not.toContain("openai");

			selectSpy.mockRestore();
		});

		it("model-restricted BYOK selection survives a DB outage via SWR", async () => {
			// Restrict the primary key and add an unrestricted sibling, mirroring
			// an org whose first account only has one model enabled upstream.
			await db
				.update(providerKey)
				.set({ allowedModels: ["special-model"] })
				.where(eq(providerKey.id, testProviderKeyOpenAi));
			await db.insert(providerKey).values({
				id: "swr-openai-unrestricted",
				token: "swr-openai-unrestricted-token",
				provider: "openai",
				organizationId: testOrgId,
				status: "active",
			});
			const filterFor =
				(modelId: string) =>
				(key: { allowedModels: string[] | null }): boolean =>
					providerKeyAllowsModel(key.allowedModels, modelId);

			expect(
				(
					await findProviderKey(
						testOrgId,
						"openai",
						"special-model",
						undefined,
						filterFor("special-model"),
					)
				)?.id,
			).toBe(testProviderKeyOpenAi);
			await waitForSwrMirrorWrites();
			await flushDrizzleCache();

			const selectSpy = vi.spyOn(cdb, "select").mockImplementation(() => {
				throw new Error("postgres unavailable");
			});

			// The filter runs on the mirrored rows, so selection keeps honoring
			// the restriction — restricted key for its model, sibling otherwise.
			expect(
				(
					await findProviderKey(
						testOrgId,
						"openai",
						"special-model",
						undefined,
						filterFor("special-model"),
					)
				)?.id,
			).toBe(testProviderKeyOpenAi);
			expect(
				(
					await findProviderKey(
						testOrgId,
						"openai",
						"some-other-model",
						undefined,
						filterFor("some-other-model"),
					)
				)?.id,
			).toBe("swr-openai-unrestricted");

			selectSpy.mockRestore();
		});

		it("throws when SWR mirror is gone and DB errors", async () => {
			await findApiKeyByToken(testApiKeyToken);
			await waitForSwrMirrorWrites();
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
			await waitForSwrMirrorWrites();

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

		it("returns effective discount SWR mirror when DB errors", async () => {
			await findEffectiveDiscount(testOrgId, "openai", "gpt-4");
			await waitForSwrMirrorWrites();
			await flushDrizzleCache();

			const selectSpy = vi.spyOn(cdb, "select").mockImplementation(() => {
				throw new Error("postgres unavailable");
			});

			const result = await findEffectiveDiscount(testOrgId, "openai", "gpt-4");
			expect(result.discount).toBe("0.25");
			expect(result.source).toBe("org_provider_model");

			selectSpy.mockRestore();
		});

		it("returns active custom models from SWR when DB errors", async () => {
			await findActiveCustomModels(testOrgId);
			await waitForSwrMirrorWrites();
			await flushDrizzleCache();

			const selectSpy = vi.spyOn(cdb, "select").mockImplementation(() => {
				throw new Error("postgres unavailable");
			});

			const result = await findActiveCustomModels(testOrgId);
			expect(result).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ id: testCustomModelId }),
				]),
			);

			selectSpy.mockRestore();
		});

		it("returns routing multiplier SWR mirror when DB errors", async () => {
			await findEffectiveRoutingScoreMultiplier("openai", "gpt-4");
			await waitForSwrMirrorWrites();
			await flushDrizzleCache();

			const selectSpy = vi.spyOn(cdb, "select").mockImplementation(() => {
				throw new Error("postgres unavailable");
			});

			const result = await findEffectiveRoutingScoreMultiplier(
				"openai",
				"gpt-4",
			);
			expect(result.scoreMultiplier).toBe("-0.2");
			expect(result.source).toBe("provider_model");

			selectSpy.mockRestore();
		});
	});

	describe("mutation invalidates SWR mirror", () => {
		it("updating a row via cdb clears SWR mirrors for that table", async () => {
			await findProjectById(testProjectId);
			await waitForSwrMirrorWrites();
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
