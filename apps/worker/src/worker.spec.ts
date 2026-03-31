import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	test,
} from "vitest";

import { db, eq, inArray, tables } from "@llmgateway/db";

import {
	acquireLock,
	cleanupExpiredLogData,
	processAutoTopUp,
} from "./worker.js";

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

	const cleanupWorkerTestData = async () => {
		await db.delete(tables.auditLog);
		await db.delete(tables.log);
		await db.delete(tables.transaction);
		await db.delete(tables.paymentMethod);
		await db.delete(tables.apiKey);
		await db.delete(tables.project);
		await db.delete(tables.userOrganization);
		await db.delete(tables.organization);
		await db.delete(tables.user);
		await db.delete(tables.lock);
	};

	const cleanupRetentionTestData = async () => {
		await db
			.delete(tables.log)
			.where(eq(tables.log.id, retentionTestIds.logId));
		await db
			.delete(tables.apiKey)
			.where(eq(tables.apiKey.id, retentionTestIds.apiKeyId));
		await db
			.delete(tables.project)
			.where(eq(tables.project.id, retentionTestIds.projectId));
		await db
			.delete(tables.organization)
			.where(eq(tables.organization.id, retentionTestIds.orgId));
		await db
			.delete(tables.user)
			.where(eq(tables.user.id, retentionTestIds.userId));
		await db
			.delete(tables.lock)
			.where(inArray(tables.lock.key, retentionTestIds.lockKeys));
	};

	beforeEach(async () => {
		await cleanupWorkerTestData();
		await cleanupRetentionTestData();
	});

	afterEach(() => {
		process.env.ENABLE_DATA_RETENTION_CLEANUP = previousDataRetentionCleanup;
	});

	afterAll(async () => {
		await cleanupWorkerTestData();
		await cleanupRetentionTestData();
	});

	describe("acquireLock", () => {
		test("should return true when acquiring a new lock", async () => {
			const lockKey = "test-lock-1";
			const result = await acquireLock(lockKey);

			expect(result).toBe(true);

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

			const firstResult = await acquireLock(lockKey);
			expect(firstResult).toBe(true);

			const secondResult = await acquireLock(lockKey);
			expect(secondResult).toBe(false);

			const locks = await db.query.lock.findMany({
				where: {
					key: { eq: lockKey },
				},
			});
			expect(locks).toHaveLength(1);
		});

		test("should clean up expired locks and allow re-acquisition", async () => {
			const lockKey = "test-lock-3";

			// eslint-disable-next-line no-mixed-operators
			const expiredTime = new Date(Date.now() - 15 * 60 * 1000);
			await db.insert(tables.lock).values({
				key: lockKey,
				updatedAt: expiredTime,
				createdAt: expiredTime,
			});

			const expiredLocks = await db.query.lock.findMany({
				where: {
					key: { eq: lockKey },
				},
			});
			expect(expiredLocks).toHaveLength(1);

			const result = await acquireLock(lockKey);
			expect(result).toBe(true);

			const newLocks = await db.query.lock.findMany({
				where: {
					key: { eq: lockKey },
				},
			});
			expect(newLocks).toHaveLength(1);
			const timeDiff = Date.now() - newLocks[0].updatedAt.getTime();
			expect(timeDiff).toBeLessThan(5000);
		});

		test("should handle multiple different locks simultaneously", async () => {
			const lockKey1 = "test-lock-4a";
			const lockKey2 = "test-lock-4b";

			const result1 = await acquireLock(lockKey1);
			const result2 = await acquireLock(lockKey2);

			expect(result1).toBe(true);
			expect(result2).toBe(true);

			const locks = await db.query.lock.findMany();
			expect(locks).toHaveLength(2);

			const lockKeys = locks.map((lock) => lock.key).sort();
			expect(lockKeys).toEqual([lockKey1, lockKey2].sort());
		});
	});

	describe("processAutoTopUp", () => {
		test("should disable auto top-up after 7 days of payment failures", async () => {
			const eightDaysMs = 8 * 24 * 60 * 60 * 1000;

			await db.insert(tables.user).values({
				id: "worker-test-user",
				email: "worker@example.com",
			});

			await db.insert(tables.organization).values({
				id: "org-disable-auto-topup",
				name: "Disable Auto Top-up",
				billingEmail: "billing@example.com",
				credits: "0",
				autoTopUpEnabled: true,
				autoTopUpThreshold: "10",
				autoTopUpAmount: "10",
				paymentFailureCount: 8,
				lastPaymentFailureAt: new Date(),
				paymentFailureStartedAt: new Date(Date.now() - eightDaysMs),
			});

			await db.insert(tables.userOrganization).values({
				userId: "worker-test-user",
				organizationId: "org-disable-auto-topup",
				role: "owner",
			});

			await processAutoTopUp();

			const organization = await db.query.organization.findFirst({
				where: {
					id: {
						eq: "org-disable-auto-topup",
					},
				},
			});

			expect(organization?.autoTopUpEnabled).toBe(false);
			expect(organization?.paymentFailureCount).toBe(0);
			expect(organization?.lastPaymentFailureAt).toBeNull();
			expect(organization?.paymentFailureStartedAt).toBeNull();

			const transactions = await db.query.transaction.findMany({
				where: {
					organizationId: {
						eq: "org-disable-auto-topup",
					},
				},
			});
			expect(transactions).toHaveLength(0);

			const auditLogs = await db.query.auditLog.findMany({
				where: {
					organizationId: {
						eq: "org-disable-auto-topup",
					},
					action: {
						eq: "payment.auto_topup.disable",
					},
				},
			});
			expect(auditLogs).toHaveLength(1);
			expect(auditLogs[0]?.userId).toBe("worker-test-user");
			expect(auditLogs[0]?.metadata).toMatchObject({
				automatic: true,
				reason: "payment_failures_exceeded_7_days",
				changes: {
					autoTopUpEnabled: {
						old: true,
						new: false,
					},
				},
				paymentFailureCount: 8,
			});
		});

		test("should keep auto top-up enabled when failures are newer than 7 days", async () => {
			const sixDaysMs = 6 * 24 * 60 * 60 * 1000;

			await db.insert(tables.organization).values({
				id: "org-keep-auto-topup",
				name: "Keep Auto Top-up",
				billingEmail: "billing@example.com",
				credits: "0",
				autoTopUpEnabled: true,
				autoTopUpThreshold: "10",
				autoTopUpAmount: "10",
				paymentFailureCount: 3,
				lastPaymentFailureAt: new Date(),
				paymentFailureStartedAt: new Date(Date.now() - sixDaysMs),
			});

			await processAutoTopUp();

			const organization = await db.query.organization.findFirst({
				where: {
					id: {
						eq: "org-keep-auto-topup",
					},
				},
			});

			expect(organization?.autoTopUpEnabled).toBe(true);
			expect(organization?.paymentFailureCount).toBe(3);
			expect(organization?.paymentFailureStartedAt).not.toBeNull();
		});
	});

	describe("cleanupExpiredLogData", () => {
		test("should null moderation payloads during retention cleanup", async () => {
			process.env.ENABLE_DATA_RETENTION_CLEANUP = "true";

			const testUser = await db
				.insert(tables.user)
				.values({
					id: retentionTestIds.userId,
					email: "retention@example.com",
					name: "Retention Test User",
				})
				.returning()
				.then((rows) => rows[0]);

			const testOrg = await db
				.insert(tables.organization)
				.values({
					id: retentionTestIds.orgId,
					name: "Retention Test Org",
					billingEmail: testUser.email,
				})
				.returning()
				.then((rows) => rows[0]);

			const testProject = await db
				.insert(tables.project)
				.values({
					id: retentionTestIds.projectId,
					organizationId: testOrg.id,
					name: "Retention Test Project",
					mode: "credits",
				})
				.returning()
				.then((rows) => rows[0]);

			const testApiKey = await db
				.insert(tables.apiKey)
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

			await db.insert(tables.log).values({
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
