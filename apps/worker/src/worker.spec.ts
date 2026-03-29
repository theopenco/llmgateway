import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	test,
} from "vitest";

import {
	apiKey,
	db,
	eq,
	inArray,
	log,
	organization,
	project,
	tables,
	user,
} from "@llmgateway/db";

import { acquireLock, cleanupExpiredLogData } from "./worker.js";

describe("worker", () => {
	const previousDataRetentionCleanup =
		process.env.ENABLE_DATA_RETENTION_CLEANUP;
	const retentionTestIds = {
		apiKeyId: "retention-test-api-key",
		lockKeys: [
			"data_retention_cleanup",
			"test-lock-1",
			"test-lock-2",
			"test-lock-3",
			"test-lock-4a",
			"test-lock-4b",
		],
		logId: "retention-test-log",
		orgId: "retention-test-org",
		projectId: "retention-test-project",
		requestId: "retention-test-request",
		userId: "retention-test-user",
	};

	const cleanupRetentionTestData = async () => {
		await db.delete(log).where(eq(log.id, retentionTestIds.logId));
		await db.delete(apiKey).where(eq(apiKey.id, retentionTestIds.apiKeyId));
		await db.delete(project).where(eq(project.id, retentionTestIds.projectId));
		await db
			.delete(organization)
			.where(eq(organization.id, retentionTestIds.orgId));
		await db.delete(user).where(eq(user.id, retentionTestIds.userId));
		await db
			.delete(tables.lock)
			.where(inArray(tables.lock.key, retentionTestIds.lockKeys));
	};

	beforeEach(async () => {
		await cleanupRetentionTestData();
	});

	afterEach(() => {
		process.env.ENABLE_DATA_RETENTION_CLEANUP = previousDataRetentionCleanup;
	});

	afterAll(async () => {
		await cleanupRetentionTestData();
	});

	describe("acquireLock", () => {
		test("should return true when acquiring a new lock", async () => {
			const lockKey = "test-lock-1";
			const result = await acquireLock(lockKey);

			expect(result).toBe(true);

			// Verify the lock was created in the database
			const locks = await db.query.lock.findMany({
				where: {
					key: { eq: lockKey },
				},
			});
			expect(locks).toHaveLength(1);
			expect(locks[0].key).toBe(lockKey);
		});

		test("should return false when acquiring a duplicate lock", async () => {
			const lockKey = "test-lock-2";

			// First acquisition should succeed
			const firstResult = await acquireLock(lockKey);
			expect(firstResult).toBe(true);

			// Second acquisition should fail due to duplicate key
			const secondResult = await acquireLock(lockKey);
			expect(secondResult).toBe(false);

			// Verify only one lock exists in the database
			const locks = await db.query.lock.findMany({
				where: {
					key: { eq: lockKey },
				},
			});
			expect(locks).toHaveLength(1);
		});

		test("should clean up expired locks and allow re-acquisition", async () => {
			const lockKey = "test-lock-3";

			// Create an expired lock by directly inserting into database
			// Set updatedAt to 15 minutes ago (longer than LOCK_DURATION_MINUTES = 10)
			// eslint-disable-next-line no-mixed-operators
			const expiredTime = new Date(Date.now() - 15 * 60 * 1000);
			await db.insert(tables.lock).values({
				key: lockKey,
				updatedAt: expiredTime,
				createdAt: expiredTime,
			});

			// Verify the expired lock exists
			const expiredLocks = await db.query.lock.findMany({
				where: {
					key: { eq: lockKey },
				},
			});
			expect(expiredLocks).toHaveLength(1);

			// Acquiring the lock should succeed (cleanup expired and create new)
			const result = await acquireLock(lockKey);
			expect(result).toBe(true);

			// Verify the lock was cleaned up and re-created
			const newLocks = await db.query.lock.findMany({
				where: {
					key: { eq: lockKey },
				},
			});
			expect(newLocks).toHaveLength(1);
			// The new lock should have a recent updatedAt time
			const timeDiff = Date.now() - newLocks[0].updatedAt.getTime();
			expect(timeDiff).toBeLessThan(5000); // Less than 5 seconds old
		});

		test("should handle multiple different locks simultaneously", async () => {
			const lockKey1 = "test-lock-4a";
			const lockKey2 = "test-lock-4b";

			// Both should succeed as they are different keys
			const result1 = await acquireLock(lockKey1);
			const result2 = await acquireLock(lockKey2);

			expect(result1).toBe(true);
			expect(result2).toBe(true);

			// Verify both locks exist
			const locks = await db.query.lock.findMany();
			expect(locks).toHaveLength(2);

			const lockKeys = locks.map((lock) => lock.key).sort();
			expect(lockKeys).toEqual([lockKey1, lockKey2].sort());
		});
	});

	describe("cleanupExpiredLogData", () => {
		test("should null moderation payloads during retention cleanup", async () => {
			process.env.ENABLE_DATA_RETENTION_CLEANUP = "true";

			const testUser = await db
				.insert(user)
				.values({
					id: retentionTestIds.userId,
					email: "retention@example.com",
					name: "Retention Test User",
				})
				.returning()
				.then((rows) => rows[0]);

			const testOrg = await db
				.insert(organization)
				.values({
					id: retentionTestIds.orgId,
					name: "Retention Test Org",
					billingEmail: testUser.email,
				})
				.returning()
				.then((rows) => rows[0]);

			const testProject = await db
				.insert(project)
				.values({
					id: retentionTestIds.projectId,
					organizationId: testOrg.id,
					name: "Retention Test Project",
					mode: "credits",
				})
				.returning()
				.then((rows) => rows[0]);

			const testApiKey = await db
				.insert(apiKey)
				.values({
					id: retentionTestIds.apiKeyId,
					projectId: testProject.id,
					token: "retention-test-token",
					description: "Retention Test API Key",
					createdBy: testUser.id,
				})
				.returning()
				.then((rows) => rows[0]);

			// eslint-disable-next-line no-mixed-operators
			const oldCreatedAt = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);

			await db.insert(log).values({
				id: retentionTestIds.logId,
				requestId: retentionTestIds.requestId,
				createdAt: oldCreatedAt,
				updatedAt: oldCreatedAt,
				organizationId: testOrg.id,
				projectId: testProject.id,
				apiKeyId: testApiKey.id,
				duration: 100,
				requestedModel: "openai/gpt-4o-mini",
				requestedProvider: "openai",
				usedModel: "gpt-4o-mini",
				usedProvider: "openai",
				responseSize: 100,
				content: "response content",
				messages: [{ role: "user", content: "hello" }],
				rawRequest: { input: "hello" },
				upstreamResponse: { output: "response content" },
				userAgent: "test-user-agent",
				gatewayContentFilterResponse: [
					{
						id: "modr-retention-test",
						model: "omni-moderation-latest",
						results: [
							{
								flagged: true,
								categories: {
									violence: true,
								},
								category_scores: {
									violence: 0.95,
								},
							},
						],
					},
				],
				mode: "credits",
				usedMode: "credits",
			});

			await cleanupExpiredLogData();

			const cleanedLog = await db.query.log.findFirst({
				where: {
					id: {
						eq: retentionTestIds.logId,
					},
				},
			});

			expect(cleanedLog).toBeTruthy();
			expect(cleanedLog?.content).toBeNull();
			expect(cleanedLog?.messages).toBeNull();
			expect(cleanedLog?.rawRequest).toBeNull();
			expect(cleanedLog?.upstreamResponse).toBeNull();
			expect(cleanedLog?.userAgent).toBeNull();
			expect(cleanedLog?.gatewayContentFilterResponse).toBeNull();
			expect(cleanedLog?.dataRetentionCleanedUp).toBe(true);
		});
	});
});
