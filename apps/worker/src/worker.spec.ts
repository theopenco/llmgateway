import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	test,
	vi,
} from "vitest";

import { db, eq, inArray, tables } from "@llmgateway/db";

import {
	acquireLock,
	cleanupExpiredLogData,
	cleanupExpiredModelHistory,
	processAutoTopUp,
} from "./worker.js";

const stripeMock = vi.hoisted(() => ({
	subscriptions: {
		retrieve: vi.fn(),
	},
	customers: {
		retrieve: vi.fn(),
	},
	paymentIntents: {
		create: vi.fn(),
	},
	paymentMethods: {
		retrieve: vi.fn(),
	},
}));

// The worker constructs its own `new Stripe()` client lazily; mocking the
// package intercepts it. Only the DevPass auto-reload tests reach Stripe —
// every other test in this file stops before any charge.
vi.mock("stripe", () => ({
	default: function MockStripe() {
		return stripeMock;
	},
}));

process.env.STRIPE_SECRET_KEY ??= "sk_test_mock";

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
			.delete(tables.modelProviderMappingHistory)
			.where(
				inArray(tables.modelProviderMappingHistory.id, [
					"mph-old",
					"mph-recent",
				]),
			);
		await db
			.delete(tables.modelHistory)
			.where(inArray(tables.modelHistory.id, ["mh-old", "mh-recent"]));
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

		test("skips devpass orgs without the pay-as-you-go opt-in", async () => {
			await db.insert(tables.organization).values({
				id: "org-devpass-payg-off",
				name: "DevPass PAYG Off",
				billingEmail: "billing@example.com",
				kind: "devpass",
				devPlan: "pro",
				devPlanPaygEnabled: false,
				credits: "0",
				autoTopUpEnabled: true,
				autoTopUpThreshold: "10",
				autoTopUpAmount: "25",
				stripeCustomerId: "cus_devpass_off",
			});

			await processAutoTopUp();

			// Filtered out before any Stripe call or pending transaction:
			// without the overflow opt-in the org cannot spend credits, so
			// auto-reload must never charge it.
			const transactions = await db.query.transaction.findMany({
				where: {
					organizationId: { eq: "org-devpass-payg-off" },
				},
			});
			expect(transactions).toHaveLength(0);
			expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
		});

		test("charges a devpass org via the subscription default card", async () => {
			await db.insert(tables.user).values({
				id: "devpass-topup-user",
				email: "devpass-topup@example.com",
			});

			// No payment_method table row on purpose: DevPass cards live on the
			// Stripe subscription, and the worker must fall back to it.
			await db.insert(tables.organization).values({
				id: "org-devpass-payg-on",
				name: "DevPass PAYG On",
				billingEmail: "billing@example.com",
				kind: "devpass",
				devPlan: "pro",
				devPlanPaygEnabled: true,
				devPlanStripeSubscriptionId: "sub_devpass_topup",
				credits: "2",
				autoTopUpEnabled: true,
				autoTopUpThreshold: "10",
				autoTopUpAmount: "25",
				stripeCustomerId: "cus_devpass_on",
			});

			await db.insert(tables.userOrganization).values({
				userId: "devpass-topup-user",
				organizationId: "org-devpass-payg-on",
				role: "owner",
			});

			stripeMock.subscriptions.retrieve.mockResolvedValue({
				default_payment_method: "pm_devpass_sub",
			});
			stripeMock.paymentMethods.retrieve.mockResolvedValue({
				customer: "cus_devpass_on",
				card: { country: "US" },
			});
			stripeMock.paymentIntents.create.mockResolvedValue({
				id: "pi_devpass_auto_topup",
				status: "succeeded",
			});

			await processAutoTopUp();

			expect(stripeMock.paymentIntents.create).toHaveBeenCalledTimes(1);
			const params = stripeMock.paymentIntents.create.mock.calls[0][0];
			expect(params.payment_method).toBe("pm_devpass_sub");
			expect(params.customer).toBe("cus_devpass_on");
			expect(params.metadata.autoTopUp).toBe("true");
			// $25 + 5% platform fee, domestic card.
			expect(params.amount).toBe(2625);

			const transactions = await db.query.transaction.findMany({
				where: {
					organizationId: { eq: "org-devpass-payg-on" },
				},
			});
			expect(transactions).toHaveLength(1);
			expect(transactions[0].stripePaymentIntentId).toBe(
				"pi_devpass_auto_topup",
			);
		});

		test("never requests 3DS, whatever the platform setting says", async () => {
			vi.clearAllMocks();
			// Both levers on at once: the admin dashboard row and the env
			// override. Neither may reach an auto top-up.
			vi.stubEnv("STRIPE_FORCE_3DS", "challenge");
			await db.insert(tables.systemSetting).values({
				id: "force_3ds",
				enabled: true,
				value: "challenge",
			});

			await db.insert(tables.organization).values({
				id: "org-devpass-payg-3ds",
				name: "DevPass PAYG 3DS",
				billingEmail: "billing@example.com",
				kind: "devpass",
				devPlan: "pro",
				devPlanPaygEnabled: true,
				devPlanStripeSubscriptionId: "sub_devpass_3ds",
				credits: "2",
				autoTopUpEnabled: true,
				autoTopUpThreshold: "10",
				autoTopUpAmount: "25",
				stripeCustomerId: "cus_devpass_3ds",
			});

			stripeMock.subscriptions.retrieve.mockResolvedValue({
				default_payment_method: "pm_devpass_3ds",
			});
			stripeMock.paymentMethods.retrieve.mockResolvedValue({
				customer: "cus_devpass_3ds",
				card: { country: "US" },
			});
			stripeMock.paymentIntents.create.mockResolvedValue({
				id: "pi_devpass_3ds",
				status: "succeeded",
			});

			await processAutoTopUp();

			// Nobody is present to answer a challenge on a scheduled charge, so
			// requesting one would turn every auto top-up into an
			// `authentication_required` decline.
			expect(stripeMock.paymentIntents.create).toHaveBeenCalledTimes(1);
			const params = stripeMock.paymentIntents.create.mock.calls[0][0];
			expect(params.off_session).toBe(true);
			expect(params.payment_method_options).toBeUndefined();

			await db.delete(tables.systemSetting);
			vi.unstubAllEnvs();
		});

		test("stops before charging when PAYG is disabled mid-pass", async () => {
			// The charging test above already invoked the payment mocks.
			vi.clearAllMocks();

			await db.insert(tables.organization).values({
				id: "org-devpass-payg-race",
				name: "DevPass PAYG Race",
				billingEmail: "billing@example.com",
				kind: "devpass",
				devPlan: "pro",
				devPlanPaygEnabled: true,
				devPlanStripeSubscriptionId: "sub_devpass_race",
				credits: "2",
				autoTopUpEnabled: true,
				autoTopUpThreshold: "10",
				autoTopUpAmount: "25",
				stripeCustomerId: "cus_devpass_race",
			});

			stripeMock.subscriptions.retrieve.mockResolvedValue({
				default_payment_method: "pm_devpass_race",
			});
			// The user disables overflow while the worker is resolving the card
			// (this mock runs before the pre-charge re-authorization). The
			// recheck must catch the change and stop before any transaction or
			// PaymentIntent is created.
			stripeMock.paymentMethods.retrieve.mockImplementation(async () => {
				await db
					.update(tables.organization)
					.set({ devPlanPaygEnabled: false })
					.where(eq(tables.organization.id, "org-devpass-payg-race"));
				return { customer: "cus_devpass_race", card: { country: "US" } };
			});

			await processAutoTopUp();

			expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
			const transactions = await db.query.transaction.findMany({
				where: {
					organizationId: { eq: "org-devpass-payg-race" },
				},
			});
			expect(transactions).toHaveLength(0);
		});

		test("skips the charge when the top-up velocity cap is reached", async () => {
			vi.clearAllMocks();
			vi.stubEnv("GATEWAY_TOPUP_VELOCITY_ENABLED", "true");

			try {
				// Brand-new devpass org => Tier 0 => $100/24h top-up cap.
				await db.insert(tables.organization).values({
					id: "org-topup-velocity",
					name: "Velocity Capped",
					billingEmail: "billing@example.com",
					kind: "devpass",
					devPlan: "pro",
					devPlanPaygEnabled: true,
					devPlanStripeSubscriptionId: "sub_velocity",
					credits: "2",
					autoTopUpEnabled: true,
					autoTopUpThreshold: "10",
					autoTopUpAmount: "25",
					stripeCustomerId: "cus_velocity",
				});
				// A completed top-up already fills the window; the next $26.25
				// gross attempt would exceed the $100 cap.
				await db.insert(tables.transaction).values({
					organizationId: "org-topup-velocity",
					type: "credit_topup",
					amount: "95",
					creditAmount: "95",
					currency: "USD",
					status: "completed",
				});

				stripeMock.subscriptions.retrieve.mockResolvedValue({
					default_payment_method: "pm_velocity",
				});
				stripeMock.paymentMethods.retrieve.mockResolvedValue({
					customer: "cus_velocity",
					card: { country: "US" },
				});

				await processAutoTopUp();

				// Skipped before the pending transaction and the PaymentIntent.
				expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
				const transactions = await db.query.transaction.findMany({
					where: {
						organizationId: { eq: "org-topup-velocity" },
					},
				});
				expect(transactions).toHaveLength(1);
			} finally {
				vi.unstubAllEnvs();
			}
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

	describe("cleanupExpiredModelHistory", () => {
		test("should delete history rows older than the retention window", async () => {
			process.env.ENABLE_DATA_RETENTION_CLEANUP = "true";

			// eslint-disable-next-line no-mixed-operators
			const oldTimestamp = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
			// eslint-disable-next-line no-mixed-operators
			const recentTimestamp = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);

			await db.insert(tables.modelProviderMappingHistory).values([
				{
					id: "mph-old",
					modelId: "retention-model",
					providerId: "retention-provider",
					modelProviderMappingId: "retention-mapping",
					minuteTimestamp: oldTimestamp,
				},
				{
					id: "mph-recent",
					modelId: "retention-model",
					providerId: "retention-provider",
					modelProviderMappingId: "retention-mapping",
					minuteTimestamp: recentTimestamp,
				},
			]);

			await db.insert(tables.modelHistory).values([
				{
					id: "mh-old",
					modelId: "retention-model",
					minuteTimestamp: oldTimestamp,
				},
				{
					id: "mh-recent",
					modelId: "retention-model",
					minuteTimestamp: recentTimestamp,
				},
			]);

			await cleanupExpiredModelHistory();

			const mappingRows = await db.query.modelProviderMappingHistory.findMany({
				where: { id: { in: ["mph-old", "mph-recent"] } },
			});
			const modelRows = await db.query.modelHistory.findMany({
				where: { id: { in: ["mh-old", "mh-recent"] } },
			});

			expect(mappingRows.map((r) => r.id)).toEqual(["mph-recent"]);
			expect(modelRows.map((r) => r.id)).toEqual(["mh-recent"]);
		});
	});
});
