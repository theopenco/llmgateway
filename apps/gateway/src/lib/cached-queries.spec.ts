import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
	db,
	apiKey,
	apiKeyIamRule,
	organization,
	project,
	providerKey,
	user,
	userOrganization,
} from "@llmgateway/db";

import {
	findApiKeyByToken,
	findProjectById,
	findOrganizationById,
	findCustomProviderKey,
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
			token: testApiKeyToken,
			projectId: testProjectId,
			description: "Test API Key for cached queries testing",
			status: "active",
			createdBy: testUserId,
		});

		await db.insert(providerKey).values({
			id: testProviderKeyId,
			token: "test-provider-token",
			provider: "openai",
			organizationId: testOrgId,
			status: "active",
		});

		await db.insert(providerKey).values({
			id: "test-custom-provider-key",
			token: "test-custom-token",
			provider: "custom",
			name: "my-custom-provider",
			baseUrl: "https://api.custom.example.com",
			organizationId: testOrgId,
			status: "active",
		});

		await db.insert(apiKeyIamRule).values({
			id: testIamRuleId,
			apiKeyId: testApiKeyId,
			ruleType: "allow_models",
			ruleValue: { models: ["gpt-4", "gpt-3.5-turbo"] },
			status: "active",
		});
	});

	afterEach(async () => {
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
		it("should find API key by token", async () => {
			const result = await findApiKeyByToken(testApiKeyToken);

			expect(result).toBeDefined();
			expect(result?.id).toBe(testApiKeyId);
			expect(result?.token).toBe(testApiKeyToken);
			expect(result?.status).toBe("active");
		});

		it("should return undefined for non-existent token", async () => {
			const result = await findApiKeyByToken("sk-nonexistent");

			expect(result).toBeUndefined();
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

	describe("findProviderKey", () => {
		it("should find provider key by organization and provider", async () => {
			const result = await findProviderKey(testOrgId, "openai");

			expect(result).toBeDefined();
			expect(result?.provider).toBe("openai");
			expect(result?.organizationId).toBe(testOrgId);
			expect(result?.status).toBe("active");
		});

		it("should return undefined for non-existent provider", async () => {
			const result = await findProviderKey(testOrgId, "nonexistent");

			expect(result).toBeUndefined();
		});
	});

	describe("findActiveProviderKeys", () => {
		it("should find all active provider keys for organization", async () => {
			const result = await findActiveProviderKeys(testOrgId);

			expect(result).toHaveLength(2); // openai and custom
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

			expect(result).toHaveLength(1);
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

			expect(result).toHaveLength(2);
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
