import { eq, and, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { redisClient } from "@llmgateway/cache";

import { db } from "./db.js";
import { RedisCache } from "./redis-cache.js";
import { relations } from "./relations.js";
import {
	apiKey,
	apiKeyIamRule,
	providerKey,
	user,
	organization,
	userOrganization,
	project,
} from "./schema.js";

/**
 * This test verifies that the cached database client (cdb) continues to serve
 * cached data even when the Postgres connection is unavailable.
 *
 * This is critical for the gateway's resilience - since it uses the cached db client,
 * it should continue to function for read operations as long as:
 * 1. The data was previously cached in Redis
 * 2. The cache TTL has not expired
 */
describe("cdb resilience - cached queries work without Postgres", () => {
	const testUserId = "test-user-resilience";
	const testOrgId = "test-org-resilience";
	const testProjectId = "test-project-resilience";
	const testApiKeyId = "test-api-key-resilience";
	const testApiKeyToken = "sk-test-resilience-token";
	const testProviderKeyId = "test-provider-key-resilience";
	const testIamRuleId = "test-iam-rule-resilience";

	// Shared Redis cache instance to ensure cache hits work across pool instances
	let sharedCache: RedisCache;

	beforeEach(async () => {
		// Clear the Redis cache
		await redisClient.flushdb();

		// Create shared cache instance
		sharedCache = new RedisCache(redisClient);

		// Clean up test data using regular db
		await db.delete(apiKeyIamRule);
		await db.delete(apiKey);
		await db.delete(providerKey);
		await db.delete(userOrganization);
		await db.delete(project);
		await db.delete(organization);
		await db.delete(user);

		// Insert test data using regular db
		await db.insert(user).values({
			id: testUserId,
			name: "Test User",
			email: "test-resilience@example.com",
		});

		await db.insert(organization).values({
			id: testOrgId,
			name: "Test Organization",
			billingEmail: "test-resilience@example.com",
			plan: "pro",
		});

		await db.insert(userOrganization).values({
			id: "test-user-org-resilience",
			userId: testUserId,
			organizationId: testOrgId,
		});

		await db.insert(project).values({
			id: testProjectId,
			name: "Test Project",
			organizationId: testOrgId,
			mode: "api-keys",
		});

		await db.insert(apiKey).values({
			id: testApiKeyId,
			token: testApiKeyToken,
			projectId: testProjectId,
			description: "Test API Key for resilience testing",
			status: "active",
			createdBy: testUserId,
		});

		// Provider keys for testing compound conditions and inArray
		await db.insert(providerKey).values({
			id: testProviderKeyId,
			token: "test-provider-token",
			provider: "openai",
			organizationId: testOrgId,
			status: "active",
		});

		await db.insert(providerKey).values({
			id: "test-provider-key-anthropic",
			token: "test-anthropic-token",
			provider: "anthropic",
			organizationId: testOrgId,
			status: "active",
		});

		// IAM rule for testing
		await db.insert(apiKeyIamRule).values({
			id: testIamRuleId,
			apiKeyId: testApiKeyId,
			ruleType: "allow_models",
			ruleValue: { models: ["gpt-4"] },
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

	it("should serve cached API key data when Postgres connection is terminated (using select builder)", async () => {
		// NOTE: This test uses the regular select() query builder because
		// the relational query API (db.query.table.findFirst) does NOT use the cache
		// in Drizzle ORM. Only db.select().from() queries are cached.

		// Step 1: Create a working pool and prime the cache
		const workingPool = new Pool({
			connectionString:
				process.env.DATABASE_URL ?? "postgres://postgres:pw@localhost:5432/db",
			max: 2,
			min: 1,
			idleTimeoutMillis: 1000,
			connectionTimeoutMillis: 5000,
		});

		const workingCdb = drizzle({
			client: workingPool,
			casing: "snake_case",
			relations,
			cache: sharedCache,
		});

		// Prime the cache by making a query using the select builder (NOT relational query API)
		const firstQueryResults = await workingCdb
			.select()
			.from(apiKey)
			.where(
				and(eq(apiKey.token, testApiKeyToken), eq(apiKey.status, "active")),
			)
			.limit(1);

		const firstQuery = firstQueryResults[0];
		expect(firstQuery).toBeDefined();
		expect(firstQuery?.id).toBe(testApiKeyId);
		expect(firstQuery?.token).toBe(testApiKeyToken);

		// Step 2: Close the working pool
		await workingPool.end();

		// Step 3: Create a pool pointing to a non-existent database
		const brokenPool = new Pool({
			connectionString: "postgres://postgres:pw@localhost:59999/nonexistent",
			max: 1,
			connectionTimeoutMillis: 100, // Fast timeout
		});

		// Create a new cdb instance with the broken pool but SAME cache instance
		const brokenCdb = drizzle({
			client: brokenPool,
			casing: "snake_case",
			relations,
			cache: sharedCache, // Same cache instance!
		});

		// Step 4: The same query should still work because it's cached
		const cachedQueryResults = await brokenCdb
			.select()
			.from(apiKey)
			.where(
				and(eq(apiKey.token, testApiKeyToken), eq(apiKey.status, "active")),
			)
			.limit(1);

		const cachedQuery = cachedQueryResults[0];
		expect(cachedQuery).toBeDefined();
		expect(cachedQuery?.id).toBe(testApiKeyId);
		expect(cachedQuery?.token).toBe(testApiKeyToken);

		// Clean up
		try {
			await brokenPool.end();
		} catch {
			// Ignore - pool may not have any connections
		}
	});

	it("IMPORTANT: relational query API (db.query.table) does NOT use cache - Postgres required", async () => {
		// This test documents the critical limitation:
		// The relational query API (db.query.table.findFirst()) does NOT go through
		// Drizzle's cache layer. This means even with a configured cache, these queries
		// will ALWAYS hit Postgres.

		const workingPool = new Pool({
			connectionString:
				process.env.DATABASE_URL ?? "postgres://postgres:pw@localhost:5432/db",
			max: 2,
			min: 1,
			idleTimeoutMillis: 1000,
			connectionTimeoutMillis: 5000,
		});

		const workingCdb = drizzle({
			client: workingPool,
			casing: "snake_case",
			relations,
			cache: sharedCache,
		});

		// Make a relational query to "prime" the cache (but it won't actually cache)
		const firstQuery = await workingCdb.query.apiKey.findFirst({
			where: {
				token: { eq: testApiKeyToken },
				status: { eq: "active" },
			},
		});
		expect(firstQuery).toBeDefined();

		await workingPool.end();

		// Create broken pool
		const brokenPool = new Pool({
			connectionString: "postgres://postgres:pw@localhost:59999/nonexistent",
			max: 1,
			connectionTimeoutMillis: 100,
		});

		const brokenCdb = drizzle({
			client: brokenPool,
			casing: "snake_case",
			relations,
			cache: sharedCache,
		});

		// This WILL FAIL because relational queries don't use the cache
		await expect(
			brokenCdb.query.apiKey.findFirst({
				where: {
					token: { eq: testApiKeyToken },
					status: { eq: "active" },
				},
			}),
		).rejects.toThrow();

		try {
			await brokenPool.end();
		} catch {
			// Ignore
		}
	});

	it("should serve cached organization data when Postgres is unavailable (using select builder)", async () => {
		const workingPool = new Pool({
			connectionString:
				process.env.DATABASE_URL ?? "postgres://postgres:pw@localhost:5432/db",
			max: 2,
			min: 1,
			idleTimeoutMillis: 1000,
			connectionTimeoutMillis: 5000,
		});

		const workingCdb = drizzle({
			client: workingPool,
			casing: "snake_case",
			relations,
			cache: sharedCache,
		});

		// Prime the cache using select builder
		const firstQueryResults = await workingCdb
			.select()
			.from(organization)
			.where(eq(organization.id, testOrgId))
			.limit(1);

		const firstQuery = firstQueryResults[0];
		expect(firstQuery).toBeDefined();
		expect(firstQuery?.id).toBe(testOrgId);
		expect(firstQuery?.name).toBe("Test Organization");

		await workingPool.end();

		// Create broken pool
		const brokenPool = new Pool({
			connectionString: "postgres://postgres:pw@localhost:59999/nonexistent",
			max: 1,
			connectionTimeoutMillis: 100,
		});

		const brokenCdb = drizzle({
			client: brokenPool,
			casing: "snake_case",
			relations,
			cache: sharedCache,
		});

		// Query should work from cache
		const cachedQueryResults = await brokenCdb
			.select()
			.from(organization)
			.where(eq(organization.id, testOrgId))
			.limit(1);

		const cachedQuery = cachedQueryResults[0];
		expect(cachedQuery).toBeDefined();
		expect(cachedQuery?.id).toBe(testOrgId);
		expect(cachedQuery?.name).toBe("Test Organization");

		try {
			await brokenPool.end();
		} catch {
			// Ignore
		}
	});

	it("should serve cached project data when Postgres is unavailable (using select builder)", async () => {
		const workingPool = new Pool({
			connectionString:
				process.env.DATABASE_URL ?? "postgres://postgres:pw@localhost:5432/db",
			max: 2,
			min: 1,
			idleTimeoutMillis: 1000,
			connectionTimeoutMillis: 5000,
		});

		const workingCdb = drizzle({
			client: workingPool,
			casing: "snake_case",
			relations,
			cache: sharedCache,
		});

		// Prime the cache using select builder
		const firstQueryResults = await workingCdb
			.select()
			.from(project)
			.where(eq(project.id, testProjectId))
			.limit(1);

		const firstQuery = firstQueryResults[0];
		expect(firstQuery).toBeDefined();
		expect(firstQuery?.id).toBe(testProjectId);

		await workingPool.end();

		const brokenPool = new Pool({
			connectionString: "postgres://postgres:pw@localhost:59999/nonexistent",
			max: 1,
			connectionTimeoutMillis: 100,
		});

		const brokenCdb = drizzle({
			client: brokenPool,
			casing: "snake_case",
			relations,
			cache: sharedCache,
		});

		// Query should work from cache
		const cachedQueryResults = await brokenCdb
			.select()
			.from(project)
			.where(eq(project.id, testProjectId))
			.limit(1);

		const cachedQuery = cachedQueryResults[0];
		expect(cachedQuery).toBeDefined();
		expect(cachedQuery?.id).toBe(testProjectId);

		try {
			await brokenPool.end();
		} catch {
			// Ignore
		}
	});

	it("should fail for uncached queries when Postgres is unavailable", async () => {
		// Create a broken pool immediately (don't prime cache)
		const brokenPool = new Pool({
			connectionString: "postgres://postgres:pw@localhost:59999/nonexistent",
			max: 1,
			connectionTimeoutMillis: 100,
		});

		const brokenCdb = drizzle({
			client: brokenPool,
			casing: "snake_case",
			relations,
			cache: sharedCache,
		});

		// Query for something that was never cached should fail
		await expect(
			brokenCdb.query.apiKey.findFirst({
				where: {
					token: { eq: "sk-never-cached-token" },
				},
			}),
		).rejects.toThrow();

		try {
			await brokenPool.end();
		} catch {
			// Ignore
		}
	});

	it("should verify cache hit is fast and does not wait for Postgres connection timeout (using select builder)", async () => {
		// This test verifies that when there's a cache hit, Postgres is not contacted at all
		const workingPool = new Pool({
			connectionString:
				process.env.DATABASE_URL ?? "postgres://postgres:pw@localhost:5432/db",
			max: 2,
			min: 1,
			idleTimeoutMillis: 1000,
			connectionTimeoutMillis: 5000,
		});

		const workingCdb = drizzle({
			client: workingPool,
			casing: "snake_case",
			relations,
			cache: sharedCache,
		});

		// Prime the cache using select builder
		const firstQueryResults = await workingCdb
			.select()
			.from(apiKey)
			.where(
				and(eq(apiKey.token, testApiKeyToken), eq(apiKey.status, "active")),
			)
			.limit(1);
		expect(firstQueryResults[0]).toBeDefined();

		await workingPool.end();

		// Create a pool with a very long connection timeout
		// If the cache works correctly, we should NOT wait for this timeout
		const slowPool = new Pool({
			connectionString: "postgres://postgres:pw@localhost:59999/nonexistent",
			max: 1,
			connectionTimeoutMillis: 5000, // 5 second timeout - we should NOT wait this long
		});

		const slowCdb = drizzle({
			client: slowPool,
			casing: "snake_case",
			relations,
			cache: sharedCache,
		});

		// If the query takes less than 1 second, it means cache was hit
		// and Postgres was never contacted (otherwise we'd wait 5+ seconds for timeout)
		const startTime = Date.now();
		const cachedQueryResults = await slowCdb
			.select()
			.from(apiKey)
			.where(
				and(eq(apiKey.token, testApiKeyToken), eq(apiKey.status, "active")),
			)
			.limit(1);
		const duration = Date.now() - startTime;

		const cachedQuery = cachedQueryResults[0];
		expect(cachedQuery).toBeDefined();
		expect(cachedQuery?.id).toBe(testApiKeyId);
		// Query should be fast (< 500ms) since it's cached
		// If it tried to connect to Postgres, it would take at least 5 seconds to timeout
		expect(duration).toBeLessThan(500);

		try {
			await slowPool.end();
		} catch {
			// Ignore
		}
	});

	/**
	 * Gateway query pattern tests - these verify the exact patterns used in
	 * apps/gateway/src/lib/cached-queries.ts are cacheable
	 */

	it("should cache provider key queries with compound AND conditions", async () => {
		const workingPool = new Pool({
			connectionString:
				process.env.DATABASE_URL ?? "postgres://postgres:pw@localhost:5432/db",
			max: 2,
			connectionTimeoutMillis: 5000,
		});

		const workingCdb = drizzle({
			client: workingPool,
			casing: "snake_case",
			relations,
			cache: sharedCache,
		});

		// Prime cache with exact pattern from findProviderKey
		const primeResults = await workingCdb
			.select()
			.from(providerKey)
			.where(
				and(
					eq(providerKey.status, "active"),
					eq(providerKey.organizationId, testOrgId),
					eq(providerKey.provider, "openai"),
				),
			)
			.limit(1);
		expect(primeResults[0]).toBeDefined();

		await workingPool.end();

		const brokenPool = new Pool({
			connectionString: "postgres://postgres:pw@localhost:59999/nonexistent",
			max: 1,
			connectionTimeoutMillis: 100,
		});

		const brokenCdb = drizzle({
			client: brokenPool,
			casing: "snake_case",
			relations,
			cache: sharedCache,
		});

		const cachedResults = await brokenCdb
			.select()
			.from(providerKey)
			.where(
				and(
					eq(providerKey.status, "active"),
					eq(providerKey.organizationId, testOrgId),
					eq(providerKey.provider, "openai"),
				),
			)
			.limit(1);

		expect(cachedResults[0]).toBeDefined();
		expect(cachedResults[0]?.provider).toBe("openai");

		try {
			await brokenPool.end();
		} catch {
			// Ignore
		}
	});

	it("should cache queries using inArray operator", async () => {
		const workingPool = new Pool({
			connectionString:
				process.env.DATABASE_URL ?? "postgres://postgres:pw@localhost:5432/db",
			max: 2,
			connectionTimeoutMillis: 5000,
		});

		const workingCdb = drizzle({
			client: workingPool,
			casing: "snake_case",
			relations,
			cache: sharedCache,
		});

		// Prime cache with exact pattern from findProviderKeysByProviders
		const providers = ["openai", "anthropic"];
		const primeResults = await workingCdb
			.select()
			.from(providerKey)
			.where(
				and(
					eq(providerKey.status, "active"),
					eq(providerKey.organizationId, testOrgId),
					inArray(providerKey.provider, providers),
				),
			);
		expect(primeResults).toHaveLength(2);

		await workingPool.end();

		const brokenPool = new Pool({
			connectionString: "postgres://postgres:pw@localhost:59999/nonexistent",
			max: 1,
			connectionTimeoutMillis: 100,
		});

		const brokenCdb = drizzle({
			client: brokenPool,
			casing: "snake_case",
			relations,
			cache: sharedCache,
		});

		const cachedResults = await brokenCdb
			.select()
			.from(providerKey)
			.where(
				and(
					eq(providerKey.status, "active"),
					eq(providerKey.organizationId, testOrgId),
					inArray(providerKey.provider, providers),
				),
			);

		expect(cachedResults).toHaveLength(2);

		try {
			await brokenPool.end();
		} catch {
			// Ignore
		}
	});

	it("should cache IAM rules queries", async () => {
		const workingPool = new Pool({
			connectionString:
				process.env.DATABASE_URL ?? "postgres://postgres:pw@localhost:5432/db",
			max: 2,
			connectionTimeoutMillis: 5000,
		});

		const workingCdb = drizzle({
			client: workingPool,
			casing: "snake_case",
			relations,
			cache: sharedCache,
		});

		// Prime cache with exact pattern from findActiveIamRules
		const primeResults = await workingCdb
			.select()
			.from(apiKeyIamRule)
			.where(
				and(
					eq(apiKeyIamRule.apiKeyId, testApiKeyId),
					eq(apiKeyIamRule.status, "active"),
				),
			);
		expect(primeResults).toHaveLength(1);

		await workingPool.end();

		const brokenPool = new Pool({
			connectionString: "postgres://postgres:pw@localhost:59999/nonexistent",
			max: 1,
			connectionTimeoutMillis: 100,
		});

		const brokenCdb = drizzle({
			client: brokenPool,
			casing: "snake_case",
			relations,
			cache: sharedCache,
		});

		const cachedResults = await brokenCdb
			.select()
			.from(apiKeyIamRule)
			.where(
				and(
					eq(apiKeyIamRule.apiKeyId, testApiKeyId),
					eq(apiKeyIamRule.status, "active"),
				),
			);

		expect(cachedResults).toHaveLength(1);
		expect(cachedResults[0]?.ruleType).toBe("allow_models");

		try {
			await brokenPool.end();
		} catch {
			// Ignore
		}
	});

	it("should cache join queries (user from organization)", async () => {
		const workingPool = new Pool({
			connectionString:
				process.env.DATABASE_URL ?? "postgres://postgres:pw@localhost:5432/db",
			max: 2,
			connectionTimeoutMillis: 5000,
		});

		const workingCdb = drizzle({
			client: workingPool,
			casing: "snake_case",
			relations,
			cache: sharedCache,
		});

		// Prime cache with exact pattern from findUserFromOrganization
		const primeResults = await workingCdb
			.select({
				userOrganization: userOrganization,
				user: user,
			})
			.from(userOrganization)
			.innerJoin(user, eq(userOrganization.userId, user.id))
			.where(eq(userOrganization.organizationId, testOrgId))
			.limit(1);
		expect(primeResults[0]).toBeDefined();
		expect(primeResults[0]?.user.id).toBe(testUserId);

		await workingPool.end();

		const brokenPool = new Pool({
			connectionString: "postgres://postgres:pw@localhost:59999/nonexistent",
			max: 1,
			connectionTimeoutMillis: 100,
		});

		const brokenCdb = drizzle({
			client: brokenPool,
			casing: "snake_case",
			relations,
			cache: sharedCache,
		});

		const cachedResults = await brokenCdb
			.select({
				userOrganization: userOrganization,
				user: user,
			})
			.from(userOrganization)
			.innerJoin(user, eq(userOrganization.userId, user.id))
			.where(eq(userOrganization.organizationId, testOrgId))
			.limit(1);

		expect(cachedResults[0]).toBeDefined();
		expect(cachedResults[0]?.user.id).toBe(testUserId);
		expect(cachedResults[0]?.user.email).toBe("test-resilience@example.com");

		try {
			await brokenPool.end();
		} catch {
			// Ignore
		}
	});
});
