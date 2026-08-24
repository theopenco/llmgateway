import { randomUUID } from "node:crypto";

import { afterAll, beforeEach, describe, expect, test } from "vitest";

import {
	cdb,
	eq,
	isNull,
	db,
	organizationCacheTag,
	tables,
	log,
	organization,
	project,
	apiKey,
	user,
} from "@llmgateway/db";

import { batchProcessLogs } from "./worker.js";

describe("Log Processing", () => {
	interface TestIds {
		apiKeyId: string;
		email: string;
		lockKey: string;
		orgId: string;
		projectId: string;
		token: string;
		userId: string;
	}

	const cleanupLogProcessingTestData = async (testIds: TestIds | null) => {
		if (!testIds) {
			return;
		}

		await db.delete(log).where(eq(log.organizationId, testIds.orgId));
		await db.delete(apiKey).where(eq(apiKey.id, testIds.apiKeyId));
		await db.delete(project).where(eq(project.id, testIds.projectId));
		await db.delete(organization).where(eq(organization.id, testIds.orgId));
		await db.delete(user).where(eq(user.email, testIds.email));
		await db.delete(tables.lock).where(eq(tables.lock.key, testIds.lockKey));
	};

	let currentTestIds: TestIds | null = null;
	let testOrg: any;
	let testProject: any;
	let testApiKey: any;

	beforeEach(async () => {
		await cleanupLogProcessingTestData(currentTestIds);

		// batchProcessLogs pulls the 100 oldest unprocessed logs globally, so any
		// stray unprocessed logs left in the shared test DB by an earlier suite can
		// starve this test's own logs out of the batch. Clear them up front.
		await db.delete(log).where(isNull(log.processedAt));

		const testIdSuffix = randomUUID();
		currentTestIds = {
			apiKeyId: `log-processing-api-key-${testIdSuffix}`,
			email: `log-processing-${testIdSuffix}@example.com`,
			lockKey: "credit_processing",
			orgId: `log-processing-org-${testIdSuffix}`,
			projectId: `log-processing-project-${testIdSuffix}`,
			token: `log-processing-token-${testIdSuffix}`,
			userId: `log-processing-user-${testIdSuffix}`,
		};

		// Create test user
		const users = await db
			.insert(user)
			.values({
				id: currentTestIds.userId,
				email: currentTestIds.email,
				name: "Test User",
			})
			.returning();
		const testUser = users[0];

		// Create test organization
		const orgs = await db
			.insert(organization)
			.values({
				id: currentTestIds.orgId,
				name: "Test Org",
				billingEmail: testUser.email,
				credits: "100.00",
			})
			.returning();
		testOrg = orgs[0];

		// Create test project
		const projects = await db
			.insert(project)
			.values({
				id: currentTestIds.projectId,
				organizationId: testOrg.id,
				name: "Test Project",
				mode: "credits",
			})
			.returning();
		testProject = projects[0];

		// Create test API key
		const keys = await db
			.insert(apiKey)
			.values({
				id: currentTestIds.apiKeyId,
				projectId: testProject.id,
				token: currentTestIds.token,
				description: "Test Key",
				usage: "0.00",
				createdBy: testUser.id,
			})
			.returning();
		testApiKey = keys[0];
	});

	afterAll(async () => {
		await cleanupLogProcessingTestData(currentTestIds);
	});

	describe("batchProcessLogs", () => {
		test("should process logs and set processedAt timestamp", async () => {
			// Insert unprocessed log directly
			const logEntries = await db
				.insert(log)
				.values({
					requestId: "test-request-batch-1",
					organizationId: testOrg.id,
					projectId: testProject.id,
					apiKeyId: testApiKey.id,
					cost: 0.005,
					cached: false,
					usedMode: "credits",
					duration: 2000,
					requestedModel: "openai/gpt-4o-mini",
					requestedProvider: "openai",
					usedModel: "gpt-4o-mini",
					usedProvider: "openai",
					responseSize: 150,
					mode: "credits",
				})
				.returning();

			const logEntry = logEntries[0];
			expect(logEntry.processedAt).toBeNull();

			// Process the logs
			await batchProcessLogs();

			// Verify log was marked as processed
			const processedLog = await db.query.log.findFirst({
				where: { id: { eq: logEntry.id } },
			});

			expect(processedLog).toBeTruthy();
			expect(processedLog!.processedAt).toBeTruthy();
			expect(processedLog!.processedAt).toBeInstanceOf(Date);
		});

		test("should deduct credits from organization for credit mode logs", async () => {
			const initialCredits = Number(testOrg.credits);

			// Insert unprocessed log with cost
			await db.insert(log).values({
				requestId: "test-request-credits",
				organizationId: testOrg.id,
				projectId: testProject.id,
				apiKeyId: testApiKey.id,
				cost: 0.01,
				cached: false,
				usedMode: "credits",
				duration: 2000,
				requestedModel: "openai/gpt-4o-mini",
				requestedProvider: "openai",
				usedModel: "gpt-4o-mini",
				usedProvider: "openai",
				responseSize: 150,
				mode: "credits",
			});

			// Process the logs
			await batchProcessLogs();

			// Verify credits were deducted
			const updatedOrg = await db.query.organization.findFirst({
				where: { id: { eq: testOrg.id } },
			});

			expect(Number(updatedOrg!.credits)).toBe(initialCredits - 0.01);
		});

		test("evicts the debited org's tagged cache entry after settling", async () => {
			// Same tagged read the gateway's findOrganizationCachedById uses.
			const readCached = async () =>
				(
					await cdb
						.select()
						.from(organization)
						.where(eq(organization.id, testOrg.id))
						.limit(1)
						.$withCache({
							tag: organizationCacheTag(testOrg.id),
							autoInvalidate: true,
						})
				)[0];

			// Prime the cache entry with the pre-debit balance.
			const before = await readCached();
			expect(Number(before.credits)).toBe(100);

			await db.insert(log).values({
				requestId: "test-request-cache-evict",
				organizationId: testOrg.id,
				projectId: testProject.id,
				apiKeyId: testApiKey.id,
				cost: 0.01,
				cached: false,
				usedMode: "credits",
				duration: 2000,
				requestedModel: "openai/gpt-4o-mini",
				requestedProvider: "openai",
				usedModel: "gpt-4o-mini",
				usedProvider: "openai",
				responseSize: 150,
				mode: "credits",
			});

			await batchProcessLogs();

			// The debit goes through the uncached client, so without the
			// worker's eviction this read would serve the stale 100.00 for the
			// full cache TTL.
			const after = await readCached();
			expect(Number(after.credits)).toBe(99.99);
		});

		test("should accrue premium weekly usage for provider-prefixed premium models on dev plans", async () => {
			await db
				.update(organization)
				.set({
					devPlan: "pro",
					devPlanCreditsLimit: "237",
					devPlanCreditsUsed: "0",
					devPlanPremiumCreditsUsed: "0",
					devPlanPremiumWeekStart: null,
				})
				.where(eq(organization.id, testOrg.id));

			// usedModel is stored as `provider/model[:region]`, not the bare
			// catalog id — the premium classification must handle that shape.
			await db.insert(log).values({
				requestId: "test-request-premium",
				organizationId: testOrg.id,
				projectId: testProject.id,
				apiKeyId: testApiKey.id,
				cost: 0.5,
				cached: false,
				usedMode: "credits",
				duration: 2000,
				requestedModel: "anthropic/claude-fable-5",
				requestedProvider: "anthropic",
				usedModel: "anthropic/claude-fable-5",
				usedProvider: "anthropic",
				responseSize: 150,
				mode: "credits",
			});

			await batchProcessLogs();

			const updatedOrg = await db.query.organization.findFirst({
				where: { id: { eq: testOrg.id } },
			});

			expect(Number(updatedOrg!.devPlanCreditsUsed)).toBe(0.5);
			expect(Number(updatedOrg!.devPlanPremiumCreditsUsed)).toBe(0.5);
			expect(updatedOrg!.devPlanPremiumWeekStart).toBeInstanceOf(Date);
		});

		test("should bill overflow to organization credits once the dev plan pool is exhausted", async () => {
			// PAYG overflow: with the monthly pool fully used, the cost cannot
			// draw from the plan pool, so the worker drains the org's regular
			// credits instead — this is the charging side of the gateway's
			// opt-in overflow gate.
			await db
				.update(organization)
				.set({
					kind: "devpass",
					devPlan: "pro",
					devPlanCreditsLimit: "237",
					devPlanCreditsUsed: "237",
					devPlanPaygEnabled: true,
				})
				.where(eq(organization.id, testOrg.id));
			const initialCredits = Number(testOrg.credits);

			await db.insert(log).values({
				requestId: "test-request-payg-overflow",
				organizationId: testOrg.id,
				projectId: testProject.id,
				apiKeyId: testApiKey.id,
				cost: 0.25,
				cached: false,
				usedMode: "credits",
				duration: 2000,
				requestedModel: "openai/gpt-4o-mini",
				requestedProvider: "openai",
				usedModel: "gpt-4o-mini",
				usedProvider: "openai",
				responseSize: 150,
				mode: "credits",
			});

			await batchProcessLogs();

			const updatedOrg = await db.query.organization.findFirst({
				where: { id: { eq: testOrg.id } },
			});

			// The exhausted pool is untouched; the overflow hit the balance.
			expect(Number(updatedOrg!.devPlanCreditsUsed)).toBe(237);
			expect(Number(updatedOrg!.credits)).toBe(initialCredits - 0.25);
		});

		test("should route premium spend past the weekly allowance to regular credits when PAYG is enabled", async () => {
			// The pro weekly premium allowance is 15% of the monthly pool
			// (237 * 0.15 = 35.55). With the counter already at the cap, an
			// over-cap premium request admitted via PAYG overflow must bill the
			// org's balance — draining the monthly pool here would make the
			// weekly cap meaningless.
			await db
				.update(organization)
				.set({
					kind: "devpass",
					devPlan: "pro",
					devPlanCreditsLimit: "237",
					devPlanCreditsUsed: "50",
					devPlanPremiumCreditsUsed: "35.55",
					devPlanPremiumWeekStart: new Date(),
					devPlanPaygEnabled: true,
				})
				.where(eq(organization.id, testOrg.id));
			const initialCredits = Number(testOrg.credits);

			await db.insert(log).values({
				requestId: "test-request-premium-weekly-overflow",
				organizationId: testOrg.id,
				projectId: testProject.id,
				apiKeyId: testApiKey.id,
				cost: 0.5,
				cached: false,
				usedMode: "credits",
				duration: 2000,
				requestedModel: "anthropic/claude-fable-5",
				requestedProvider: "anthropic",
				usedModel: "anthropic/claude-fable-5",
				usedProvider: "anthropic",
				responseSize: 150,
				mode: "credits",
			});

			await batchProcessLogs();

			const updatedOrg = await db.query.organization.findFirst({
				where: { id: { eq: testOrg.id } },
			});

			// Plan pool and premium counter untouched; the balance paid.
			expect(Number(updatedOrg!.devPlanCreditsUsed)).toBe(50);
			expect(Number(updatedOrg!.devPlanPremiumCreditsUsed)).toBe(35.55);
			expect(Number(updatedOrg!.credits)).toBe(initialCredits - 0.5);
		});

		test("should split premium spend across the weekly allowance boundary when PAYG is enabled", async () => {
			// 0.30 of weekly premium allowance left (35.55 - 35.25): a 0.50
			// premium charge takes 0.30 from the plan pool and overflows the
			// remaining 0.20 to the balance.
			await db
				.update(organization)
				.set({
					kind: "devpass",
					devPlan: "pro",
					devPlanCreditsLimit: "237",
					devPlanCreditsUsed: "50",
					devPlanPremiumCreditsUsed: "35.25",
					devPlanPremiumWeekStart: new Date(),
					devPlanPaygEnabled: true,
				})
				.where(eq(organization.id, testOrg.id));
			const initialCredits = Number(testOrg.credits);

			await db.insert(log).values({
				requestId: "test-request-premium-weekly-split",
				organizationId: testOrg.id,
				projectId: testProject.id,
				apiKeyId: testApiKey.id,
				cost: 0.5,
				cached: false,
				usedMode: "credits",
				duration: 2000,
				requestedModel: "anthropic/claude-fable-5",
				requestedProvider: "anthropic",
				usedModel: "anthropic/claude-fable-5",
				usedProvider: "anthropic",
				responseSize: 150,
				mode: "credits",
			});

			await batchProcessLogs();

			const updatedOrg = await db.query.organization.findFirst({
				where: { id: { eq: testOrg.id } },
			});

			expect(Number(updatedOrg!.devPlanCreditsUsed)).toBeCloseTo(50.3, 6);
			expect(Number(updatedOrg!.devPlanPremiumCreditsUsed)).toBeCloseTo(
				35.55,
				6,
			);
			expect(Number(updatedOrg!.credits)).toBeCloseTo(initialCredits - 0.2, 6);
		});

		test("should keep over-cap premium spend on the plan pool when PAYG is disabled", async () => {
			// Without the opt-in the gateway never admits over-cap premium
			// requests, but requests already in flight when the cap was crossed
			// can land here. The balance is unspendable without the opt-in, so
			// the spend stays on the plan pool exactly as before.
			await db
				.update(organization)
				.set({
					kind: "devpass",
					devPlan: "pro",
					devPlanCreditsLimit: "237",
					devPlanCreditsUsed: "50",
					devPlanPremiumCreditsUsed: "35.55",
					devPlanPremiumWeekStart: new Date(),
					devPlanPaygEnabled: false,
				})
				.where(eq(organization.id, testOrg.id));
			const initialCredits = Number(testOrg.credits);

			await db.insert(log).values({
				requestId: "test-request-premium-weekly-payg-off",
				organizationId: testOrg.id,
				projectId: testProject.id,
				apiKeyId: testApiKey.id,
				cost: 0.5,
				cached: false,
				usedMode: "credits",
				duration: 2000,
				requestedModel: "anthropic/claude-fable-5",
				requestedProvider: "anthropic",
				usedModel: "anthropic/claude-fable-5",
				usedProvider: "anthropic",
				responseSize: 150,
				mode: "credits",
			});

			await batchProcessLogs();

			const updatedOrg = await db.query.organization.findFirst({
				where: { id: { eq: testOrg.id } },
			});

			expect(Number(updatedOrg!.devPlanCreditsUsed)).toBeCloseTo(50.5, 6);
			expect(Number(updatedOrg!.devPlanPremiumCreditsUsed)).toBeCloseTo(
				36.05,
				6,
			);
			expect(Number(updatedOrg!.credits)).toBe(initialCredits);
		});

		test("should keep overflow on the plan pool when PAYG is disabled", async () => {
			// Without the overflow opt-in the gateway zeroes the credits pool,
			// so a balance the org holds (an admin gift, a referral payout) is
			// unspendable. Draining it here would silently consume that gift
			// and push an empty balance negative. Requests admitted while the
			// pool still had room can still overshoot it, so the excess stays
			// recorded as plan usage instead.
			await db
				.update(organization)
				.set({
					kind: "devpass",
					devPlan: "pro",
					devPlanCreditsLimit: "237",
					devPlanCreditsUsed: "236.9",
					devPlanPaygEnabled: false,
				})
				.where(eq(organization.id, testOrg.id));
			const initialCredits = Number(testOrg.credits);

			await db.insert(log).values({
				requestId: "test-request-payg-off-overflow",
				organizationId: testOrg.id,
				projectId: testProject.id,
				apiKeyId: testApiKey.id,
				cost: 0.25,
				cached: false,
				usedMode: "credits",
				duration: 2000,
				requestedModel: "openai/gpt-4o-mini",
				requestedProvider: "openai",
				usedModel: "gpt-4o-mini",
				usedProvider: "openai",
				responseSize: 150,
				mode: "credits",
			});

			await batchProcessLogs();

			const updatedOrg = await db.query.organization.findFirst({
				where: { id: { eq: testOrg.id } },
			});

			expect(Number(updatedOrg!.credits)).toBe(initialCredits);
			expect(Number(updatedOrg!.devPlanCreditsUsed)).toBeCloseTo(237.15, 6);
		});

		test("should not deduct credits for api-keys mode logs (no BYOK fee)", async () => {
			const initialCredits = Number(testOrg.credits);

			// Insert unprocessed log with api-keys mode
			await db.insert(log).values({
				requestId: "test-request-api-keys",
				organizationId: testOrg.id,
				projectId: testProject.id,
				apiKeyId: testApiKey.id,
				cost: 0.01,
				cached: false,
				usedMode: "api-keys",
				duration: 2000,
				requestedModel: "openai/gpt-4o-mini",
				requestedProvider: "openai",
				usedModel: "gpt-4o-mini",
				usedProvider: "openai",
				responseSize: 150,
				mode: "api-keys",
			});

			// Process the logs
			await batchProcessLogs();

			// Verify no credits were deducted for api-keys mode
			const updatedOrg = await db.query.organization.findFirst({
				where: { id: { eq: testOrg.id } },
			});

			expect(Number(updatedOrg!.credits)).toBe(initialCredits);
		});

		test("should deduct storage cost on top of inference cost for credits mode logs", async () => {
			const initialCredits = Number(testOrg.credits);

			await db.insert(log).values({
				requestId: "test-request-credits-storage",
				organizationId: testOrg.id,
				projectId: testProject.id,
				apiKeyId: testApiKey.id,
				cost: 0.01,
				dataStorageCost: "0.002",
				cached: false,
				usedMode: "credits",
				duration: 2000,
				requestedModel: "openai/gpt-4o-mini",
				requestedProvider: "openai",
				usedModel: "gpt-4o-mini",
				usedProvider: "openai",
				responseSize: 150,
				mode: "credits",
			});

			await batchProcessLogs();

			const updatedOrg = await db.query.organization.findFirst({
				where: { id: { eq: testOrg.id } },
			});

			expect(Number(updatedOrg!.credits)).toBe(initialCredits - 0.012);
		});

		test("should deduct only storage cost for api-keys mode logs", async () => {
			const initialCredits = Number(testOrg.credits);

			await db.insert(log).values({
				requestId: "test-request-api-keys-storage",
				organizationId: testOrg.id,
				projectId: testProject.id,
				apiKeyId: testApiKey.id,
				cost: 0.01,
				dataStorageCost: "0.002",
				cached: false,
				usedMode: "api-keys",
				duration: 2000,
				requestedModel: "openai/gpt-4o-mini",
				requestedProvider: "openai",
				usedModel: "gpt-4o-mini",
				usedProvider: "openai",
				responseSize: 150,
				mode: "api-keys",
			});

			await batchProcessLogs();

			const updatedOrg = await db.query.organization.findFirst({
				where: { id: { eq: testOrg.id } },
			});

			expect(Number(updatedOrg!.credits)).toBe(initialCredits - 0.002);
		});

		test("should deduct storage cost even when inference cost is zero", async () => {
			const initialCredits = Number(testOrg.credits);

			// Unbilled refusals zero the inference cost but keep the storage cost
			// (retention is billed separately from inference).
			await db.insert(log).values({
				requestId: "test-request-zero-cost-storage",
				organizationId: testOrg.id,
				projectId: testProject.id,
				apiKeyId: testApiKey.id,
				cost: 0,
				dataStorageCost: "0.003",
				cached: false,
				usedMode: "credits",
				duration: 2000,
				requestedModel: "openai/gpt-4o-mini",
				requestedProvider: "openai",
				usedModel: "gpt-4o-mini",
				usedProvider: "openai",
				responseSize: 150,
				mode: "credits",
			});

			await batchProcessLogs();

			const updatedOrg = await db.query.organization.findFirst({
				where: { id: { eq: testOrg.id } },
			});

			expect(Number(updatedOrg!.credits)).toBe(initialCredits - 0.003);
		});

		test("should update API key usage for all non-cached logs with cost", async () => {
			const initialUsage = Number(testApiKey.usage);

			// Insert unprocessed log
			await db.insert(log).values({
				requestId: "test-request-usage",
				organizationId: testOrg.id,
				projectId: testProject.id,
				apiKeyId: testApiKey.id,
				cost: 0.02,
				cached: false,
				usedMode: "credits",
				duration: 2000,
				requestedModel: "openai/gpt-4o-mini",
				requestedProvider: "openai",
				usedModel: "gpt-4o-mini",
				usedProvider: "openai",
				responseSize: 150,
				mode: "credits",
			});

			// Process the logs
			await batchProcessLogs();

			// Verify API key usage was updated
			const updatedKey = await db.query.apiKey.findFirst({
				where: { id: { eq: testApiKey.id } },
			});

			expect(Number(updatedKey!.usage)).toBe(initialUsage + 0.02);
		});

		test("should update current period usage for active period limits", async () => {
			const activeWindowOffsetMs = 60 * 60 * 1000;
			const activeWindowStartedAt = new Date(Date.now() - activeWindowOffsetMs);

			await db
				.update(apiKey)
				.set({
					periodUsageLimit: "10.00",
					periodUsageDurationValue: 1,
					periodUsageDurationUnit: "day",
					currentPeriodUsage: "1.50",
					currentPeriodStartedAt: activeWindowStartedAt,
				})
				.where(eq(apiKey.id, testApiKey.id));

			await db.insert(log).values({
				requestId: "test-request-period-usage",
				organizationId: testOrg.id,
				projectId: testProject.id,
				apiKeyId: testApiKey.id,
				cost: 0.25,
				cached: false,
				usedMode: "credits",
				duration: 2000,
				requestedModel: "openai/gpt-4o-mini",
				requestedProvider: "openai",
				usedModel: "gpt-4o-mini",
				usedProvider: "openai",
				responseSize: 150,
				mode: "credits",
			});

			await batchProcessLogs();

			const updatedKey = await db.query.apiKey.findFirst({
				where: { id: { eq: testApiKey.id } },
			});

			expect(Number(updatedKey!.currentPeriodUsage)).toBe(1.75);
			expect(updatedKey!.currentPeriodStartedAt).not.toBeNull();
		});

		test("should update current period usage for api-keys mode logs", async () => {
			const activeWindowOffsetMs = 60 * 60 * 1000;
			const activeWindowStartedAt = new Date(Date.now() - activeWindowOffsetMs);

			await db
				.update(apiKey)
				.set({
					periodUsageLimit: "10.00",
					periodUsageDurationValue: 1,
					periodUsageDurationUnit: "day",
					currentPeriodUsage: "1.50",
					currentPeriodStartedAt: activeWindowStartedAt,
				})
				.where(eq(apiKey.id, testApiKey.id));

			await db.insert(log).values({
				requestId: "test-request-period-usage-api-keys",
				organizationId: testOrg.id,
				projectId: testProject.id,
				apiKeyId: testApiKey.id,
				cost: 0.25,
				cached: false,
				usedMode: "api-keys",
				duration: 2000,
				requestedModel: "openai/gpt-4o-mini",
				requestedProvider: "openai",
				usedModel: "gpt-4o-mini",
				usedProvider: "openai",
				responseSize: 150,
				mode: "api-keys",
			});

			await batchProcessLogs();

			const updatedKey = await db.query.apiKey.findFirst({
				where: { id: { eq: testApiKey.id } },
			});

			expect(Number(updatedKey!.currentPeriodUsage)).toBe(1.75);
			expect(updatedKey!.currentPeriodStartedAt).not.toBeNull();
		});

		test("should reset expired current period usage before adding new cost", async () => {
			const expiredWindowOffsetMs = 2 * 60 * 60 * 1000;
			const expiredWindowStartedAt = new Date(
				Date.now() - expiredWindowOffsetMs,
			);

			await db
				.update(apiKey)
				.set({
					periodUsageLimit: "10.00",
					periodUsageDurationValue: 1,
					periodUsageDurationUnit: "hour",
					currentPeriodUsage: "4.00",
					currentPeriodStartedAt: expiredWindowStartedAt,
				})
				.where(eq(apiKey.id, testApiKey.id));

			await db.insert(log).values({
				requestId: "test-request-period-reset",
				organizationId: testOrg.id,
				projectId: testProject.id,
				apiKeyId: testApiKey.id,
				cost: 0.4,
				cached: false,
				usedMode: "credits",
				duration: 2000,
				requestedModel: "openai/gpt-4o-mini",
				requestedProvider: "openai",
				usedModel: "gpt-4o-mini",
				usedProvider: "openai",
				responseSize: 150,
				mode: "credits",
			});

			await batchProcessLogs();

			const updatedKey = await db.query.apiKey.findFirst({
				where: { id: { eq: testApiKey.id } },
			});

			expect(Number(updatedKey!.currentPeriodUsage)).toBe(0.4);
			expect(updatedKey!.currentPeriodStartedAt).not.toBeNull();
			expect(Number(updatedKey!.usage)).toBe(0.4);
		});

		test("should split delayed logs using event timestamps across windows", async () => {
			await db
				.update(apiKey)
				.set({
					periodUsageLimit: "10.00",
					periodUsageDurationValue: 1,
					periodUsageDurationUnit: "hour",
					currentPeriodUsage: "4.00",
					currentPeriodStartedAt: new Date("2026-03-29T10:00:00.000Z"),
				})
				.where(eq(apiKey.id, testApiKey.id));

			await db.insert(log).values([
				{
					requestId: "test-request-period-before-reset",
					organizationId: testOrg.id,
					projectId: testProject.id,
					apiKeyId: testApiKey.id,
					cost: 0.25,
					cached: false,
					usedMode: "credits",
					duration: 2000,
					requestedModel: "openai/gpt-4o-mini",
					requestedProvider: "openai",
					usedModel: "gpt-4o-mini",
					usedProvider: "openai",
					responseSize: 150,
					mode: "credits",
					createdAt: new Date("2026-03-29T10:30:00.000Z"),
				},
				{
					requestId: "test-request-period-after-reset",
					organizationId: testOrg.id,
					projectId: testProject.id,
					apiKeyId: testApiKey.id,
					cost: 0.4,
					cached: false,
					usedMode: "credits",
					duration: 2000,
					requestedModel: "openai/gpt-4o-mini",
					requestedProvider: "openai",
					usedModel: "gpt-4o-mini",
					usedProvider: "openai",
					responseSize: 150,
					mode: "credits",
					createdAt: new Date("2026-03-29T11:30:00.000Z"),
				},
			]);

			await batchProcessLogs();

			const updatedKey = await db.query.apiKey.findFirst({
				where: { id: { eq: testApiKey.id } },
			});

			expect(Number(updatedKey!.usage)).toBe(0.65);
			expect(Number(updatedKey!.currentPeriodUsage)).toBe(0.4);
			expect(updatedKey!.currentPeriodStartedAt?.toISOString()).toBe(
				"2026-03-29T11:30:00.000Z",
			);
		});

		test("should not update costs for cached logs", async () => {
			const initialCredits = Number(testOrg.credits);
			const initialUsage = Number(testApiKey.usage);

			// Insert cached log with cost
			await db.insert(log).values({
				requestId: "test-request-cached",
				organizationId: testOrg.id,
				projectId: testProject.id,
				apiKeyId: testApiKey.id,
				cost: 0.01,
				cached: true,
				usedMode: "credits",
				duration: 100,
				requestedModel: "openai/gpt-4o-mini",
				requestedProvider: "openai",
				usedModel: "gpt-4o-mini",
				usedProvider: "openai",
				responseSize: 150,
				mode: "credits",
			});

			// Process the logs
			await batchProcessLogs();

			// Verify no costs were deducted for cached log
			const updatedOrg = await db.query.organization.findFirst({
				where: { id: { eq: testOrg.id } },
			});
			const updatedKey = await db.query.apiKey.findFirst({
				where: { id: { eq: testApiKey.id } },
			});

			expect(Number(updatedOrg!.credits)).toBe(initialCredits);
			expect(Number(updatedKey!.usage)).toBe(initialUsage);
		});

		test("should process multiple logs in a batch", async () => {
			const initialCredits = Number(testOrg.credits);
			const initialUsage = Number(testApiKey.usage);

			// Insert multiple unprocessed logs
			await db.insert(log).values([
				{
					requestId: "test-request-batch-1",
					organizationId: testOrg.id,
					projectId: testProject.id,
					apiKeyId: testApiKey.id,
					cost: 0.01,
					cached: false,
					usedMode: "credits",
					duration: 1000,
					requestedModel: "openai/gpt-4o-mini",
					requestedProvider: "openai",
					usedModel: "gpt-4o-mini",
					usedProvider: "openai",
					responseSize: 100,
					mode: "credits",
				},
				{
					requestId: "test-request-batch-2",
					organizationId: testOrg.id,
					projectId: testProject.id,
					apiKeyId: testApiKey.id,
					cost: 0.02,
					cached: false,
					usedMode: "credits",
					duration: 1500,
					requestedModel: "openai/gpt-4o-mini",
					requestedProvider: "openai",
					usedModel: "gpt-4o-mini",
					usedProvider: "openai",
					responseSize: 150,
					mode: "credits",
				},
			]);

			// Process the logs
			await batchProcessLogs();

			// Verify all logs were processed
			const processedLogs = await db.query.log.findMany({
				where: {
					organizationId: { eq: testOrg.id },
					processedAt: { isNotNull: true },
				},
			});
			expect(processedLogs).toHaveLength(2);

			// Verify total costs were deducted
			const updatedOrg = await db.query.organization.findFirst({
				where: { id: { eq: testOrg.id } },
			});
			const updatedKey = await db.query.apiKey.findFirst({
				where: { id: { eq: testApiKey.id } },
			});

			expect(Number(updatedOrg!.credits)).toBe(initialCredits - 0.03);
			expect(Number(updatedKey!.usage)).toBe(initialUsage + 0.03);
		});

		test("should not process already processed logs", async () => {
			const initialCredits = Number(testOrg.credits);

			// Insert already processed log
			await db.insert(log).values({
				requestId: "test-request-already-processed",
				organizationId: testOrg.id,
				projectId: testProject.id,
				apiKeyId: testApiKey.id,
				cost: 0.01,
				cached: false,
				usedMode: "credits",
				duration: 1000,
				requestedModel: "openai/gpt-4o-mini",
				requestedProvider: "openai",
				usedModel: "gpt-4o-mini",
				usedProvider: "openai",
				responseSize: 100,
				mode: "credits",
				processedAt: new Date(),
			});

			// Process the logs
			await batchProcessLogs();

			// Verify credits were not double-deducted
			const updatedOrg = await db.query.organization.findFirst({
				where: { id: { eq: testOrg.id } },
			});

			expect(Number(updatedOrg!.credits)).toBe(initialCredits);
		});
	});

	describe("provider key spend limits", () => {
		const insertProviderLog = (values: {
			providerKeyId: string | null;
			cost: number;
			cached?: boolean;
			usedMode?: "api-keys" | "credits";
		}) =>
			db.insert(log).values({
				requestId: `test-request-pk-${randomUUID()}`,
				organizationId: testOrg.id,
				projectId: testProject.id,
				apiKeyId: testApiKey.id,
				providerKeyId: values.providerKeyId,
				cost: values.cost,
				cached: values.cached ?? false,
				usedMode: values.usedMode ?? "credits",
				duration: 1000,
				requestedModel: "openai/gpt-4o-mini",
				requestedProvider: "openai",
				usedModel: "gpt-4o-mini",
				usedProvider: "openai",
				responseSize: 100,
				mode: "credits",
			});

		const insertByokKey = async (overrides?: {
			usageLimit?: string | null;
			usage?: string;
			status?: "active" | "inactive";
		}) => {
			const [key] = await db
				.insert(tables.providerKey)
				.values({
					id: `pk-spend-${randomUUID()}`,
					token: `sk-test-${randomUUID()}`,
					provider: "openai",
					organizationId: testOrg.id,
					usageLimit: overrides?.usageLimit ?? null,
					usage: overrides?.usage ?? "0",
					status: overrides?.status ?? "active",
				})
				.returning();
			return key;
		};

		test("accumulates usage per provider key from log cost", async () => {
			const key = await insertByokKey();

			await insertProviderLog({ providerKeyId: key.id, cost: 0.01 });
			// BYOK traffic (api-keys mode) still spends the credential upstream.
			await insertProviderLog({
				providerKeyId: key.id,
				cost: 0.02,
				usedMode: "api-keys",
			});

			await batchProcessLogs();

			const updated = await db.query.providerKey.findFirst({
				where: { id: { eq: key.id } },
			});
			expect(Number(updated!.usage)).toBeCloseTo(0.03, 8);
			expect(updated!.status).toBe("active");
		});

		test("does not accumulate for cached responses or unattributed logs", async () => {
			const key = await insertByokKey();

			await insertProviderLog({
				providerKeyId: key.id,
				cost: 0.01,
				cached: true,
			});
			await insertProviderLog({ providerKeyId: null, cost: 0.02 });

			await batchProcessLogs();

			const updated = await db.query.providerKey.findFirst({
				where: { id: { eq: key.id } },
			});
			expect(Number(updated!.usage)).toBe(0);
		});

		test("auto-deactivates a key when usage crosses its spend limit", async () => {
			const key = await insertByokKey({ usageLimit: "0.05", usage: "0.04" });

			await insertProviderLog({ providerKeyId: key.id, cost: 0.02 });

			await batchProcessLogs();

			const updated = await db.query.providerKey.findFirst({
				where: { id: { eq: key.id } },
			});
			expect(Number(updated!.usage)).toBeCloseTo(0.06, 8);
			expect(updated!.status).toBe("inactive");
		});

		test("leaves a key active while under its spend limit", async () => {
			const key = await insertByokKey({ usageLimit: "1.00" });

			await insertProviderLog({ providerKeyId: key.id, cost: 0.02 });

			await batchProcessLogs();

			const updated = await db.query.providerKey.findFirst({
				where: { id: { eq: key.id } },
			});
			expect(Number(updated!.usage)).toBeCloseTo(0.02, 8);
			expect(updated!.status).toBe("active");
		});

		test("never deactivates a key without a spend limit", async () => {
			const key = await insertByokKey({ usageLimit: null });

			await insertProviderLog({ providerKeyId: key.id, cost: 5 });

			await batchProcessLogs();

			const updated = await db.query.providerKey.findFirst({
				where: { id: { eq: key.id } },
			});
			expect(Number(updated!.usage)).toBe(5);
			expect(updated!.status).toBe("active");
		});

		test("accumulates and deactivates managed credentials (no organization)", async () => {
			const [managedKey] = await db
				.insert(tables.providerKey)
				.values({
					id: `pk-spend-managed-${randomUUID()}`,
					token: `sk-managed-${randomUUID()}`,
					provider: "openai",
					managed: true,
					organizationId: null,
					usageLimit: "0.01",
					usage: "0",
				})
				.returning();

			try {
				await insertProviderLog({ providerKeyId: managedKey.id, cost: 0.02 });

				await batchProcessLogs();

				const updated = await db.query.providerKey.findFirst({
					where: { id: { eq: managedKey.id } },
				});
				expect(Number(updated!.usage)).toBeCloseTo(0.02, 8);
				expect(updated!.status).toBe("inactive");
			} finally {
				// Managed rows have no organization, so the org-cascade cleanup in
				// beforeEach never removes them.
				await db
					.delete(tables.providerKey)
					.where(eq(tables.providerKey.id, managedKey.id));
			}
		});

		test("keeps accumulating on an already-inactive key without error", async () => {
			const key = await insertByokKey({
				usageLimit: "0.01",
				usage: "0.05",
				status: "inactive",
			});

			await insertProviderLog({ providerKeyId: key.id, cost: 0.01 });

			await batchProcessLogs();

			const updated = await db.query.providerKey.findFirst({
				where: { id: { eq: key.id } },
			});
			expect(Number(updated!.usage)).toBeCloseTo(0.06, 8);
			expect(updated!.status).toBe("inactive");
		});
	});
});
