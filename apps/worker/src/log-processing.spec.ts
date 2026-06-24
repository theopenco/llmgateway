import { randomUUID } from "node:crypto";

import { afterAll, beforeEach, describe, expect, test } from "vitest";

import {
	eq,
	isNull,
	db,
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

		test("should let default org credits go negative on overage", async () => {
			// Regular (kind: "default") orgs are allowed to go negative — the
			// balance is reconciled on the next top-up, so flooring would lose
			// genuinely incurred usage.
			await db
				.update(organization)
				.set({ credits: "0.01", kind: "default" })
				.where(eq(organization.id, testOrg.id));

			await db.insert(log).values({
				requestId: "test-request-default-negative",
				organizationId: testOrg.id,
				projectId: testProject.id,
				apiKeyId: testApiKey.id,
				cost: 0.05,
				cached: false,
				usedMode: "credits",
				duration: 1000,
				requestedModel: "openai/gpt-4o-mini",
				requestedProvider: "openai",
				usedModel: "gpt-4o-mini",
				usedProvider: "openai",
				responseSize: 100,
				mode: "credits",
			});

			await batchProcessLogs();

			const updatedOrg = await db.query.organization.findFirst({
				where: { id: { eq: testOrg.id } },
			});

			expect(Number(updatedOrg!.credits)).toBeCloseTo(-0.04, 10);
		});

		test("should write off devpass residual when there is no credit balance", async () => {
			// devpass orgs run on dev-plan virtual credits and hold no real
			// balance. Usage that drains after the plan was cancelled (no active
			// pool, zero credits) must be written off, never driving `credits`
			// negative.
			await db
				.update(organization)
				.set({ credits: "0.00", kind: "devpass", devPlan: "none" })
				.where(eq(organization.id, testOrg.id));

			await db.insert(log).values({
				requestId: "test-request-devpass-writeoff",
				organizationId: testOrg.id,
				projectId: testProject.id,
				apiKeyId: testApiKey.id,
				cost: 0.05,
				cached: false,
				usedMode: "credits",
				duration: 1000,
				requestedModel: "openai/gpt-4o-mini",
				requestedProvider: "openai",
				usedModel: "gpt-4o-mini",
				usedProvider: "openai",
				responseSize: 100,
				mode: "credits",
			});

			await batchProcessLogs();

			const updatedOrg = await db.query.organization.findFirst({
				where: { id: { eq: testOrg.id } },
			});

			// Unchanged — written off rather than charged to real credits.
			expect(Number(updatedOrg!.credits)).toBe(0);
		});

		test("should debit real credits for chat pay-as-you-go orgs", async () => {
			// A chat org with a positive pay-as-you-go balance and no chat plan
			// is authorized by `credits` at the gateway, so the worker must debit
			// `credits` — not write the usage off (which would let it spend the
			// same balance indefinitely).
			await db
				.update(organization)
				.set({ credits: "0.10", kind: "chat", chatPlan: "none" })
				.where(eq(organization.id, testOrg.id));

			await db.insert(log).values({
				requestId: "test-request-chat-payg",
				organizationId: testOrg.id,
				projectId: testProject.id,
				apiKeyId: testApiKey.id,
				cost: 0.05,
				cached: false,
				usedMode: "credits",
				duration: 1000,
				requestedModel: "openai/gpt-4o-mini",
				requestedProvider: "openai",
				usedModel: "gpt-4o-mini",
				usedProvider: "openai",
				responseSize: 100,
				mode: "credits",
			});

			await batchProcessLogs();

			const updatedOrg = await db.query.organization.findFirst({
				where: { id: { eq: testOrg.id } },
			});

			expect(Number(updatedOrg!.credits)).toBeCloseTo(0.05, 10);
		});

		test("should drain dev plan up to its limit and write off the overage when there is no balance", async () => {
			// Active dev plan whose cycle allowance is exhausted by an in-flight
			// request, with no real credits. The plan absorbs up to its limit;
			// the overage is written off — never charged to real credits, and not
			// over-counted past the plan limit.
			await db
				.update(organization)
				.set({
					credits: "0.00",
					kind: "devpass",
					devPlan: "pro",
					devPlanCreditsLimit: "0.02",
					devPlanCreditsUsed: "0.00",
				})
				.where(eq(organization.id, testOrg.id));

			await db.insert(log).values({
				requestId: "test-request-dev-overage-nobalance",
				organizationId: testOrg.id,
				projectId: testProject.id,
				apiKeyId: testApiKey.id,
				cost: 0.05,
				cached: false,
				usedMode: "credits",
				duration: 1000,
				requestedModel: "openai/gpt-4o-mini",
				requestedProvider: "openai",
				usedModel: "gpt-4o-mini",
				usedProvider: "openai",
				responseSize: 100,
				mode: "credits",
			});

			await batchProcessLogs();

			const updatedOrg = await db.query.organization.findFirst({
				where: { id: { eq: testOrg.id } },
			});

			expect(Number(updatedOrg!.credits)).toBe(0);
			// Drained up to the limit only; the $0.03 overage is written off.
			expect(Number(updatedOrg!.devPlanCreditsUsed)).toBeCloseTo(0.02, 10);
		});

		test("should debit real credits for dev plan overage when the org has a balance", async () => {
			// Dev plan exhausted, but the org holds a real balance (e.g. referral
			// earnings) that the gateway counted toward admission. The overage must
			// come out of real credits, NOT push devPlanCreditsUsed past the limit
			// (which would spend the balance silently and reset at renewal).
			await db
				.update(organization)
				.set({
					credits: "1.00",
					kind: "devpass",
					devPlan: "pro",
					devPlanCreditsLimit: "0.02",
					devPlanCreditsUsed: "0.00",
				})
				.where(eq(organization.id, testOrg.id));

			await db.insert(log).values({
				requestId: "test-request-dev-overage-balance",
				organizationId: testOrg.id,
				projectId: testProject.id,
				apiKeyId: testApiKey.id,
				cost: 0.05,
				cached: false,
				usedMode: "credits",
				duration: 1000,
				requestedModel: "openai/gpt-4o-mini",
				requestedProvider: "openai",
				usedModel: "gpt-4o-mini",
				usedProvider: "openai",
				responseSize: 100,
				mode: "credits",
			});

			await batchProcessLogs();

			const updatedOrg = await db.query.organization.findFirst({
				where: { id: { eq: testOrg.id } },
			});

			// Plan drained to its limit; the $0.03 overage debited from credits.
			expect(Number(updatedOrg!.devPlanCreditsUsed)).toBeCloseTo(0.02, 10);
			expect(Number(updatedOrg!.credits)).toBeCloseTo(0.97, 10);
		});

		test("should debit PAYG credits for chat plan overage", async () => {
			// Active chat plan exhausted, with a positive pay-as-you-go balance.
			// The overage the PAYG balance made billable must debit real credits,
			// not push chatPlanCreditsUsed past the limit.
			await db
				.update(organization)
				.set({
					credits: "1.00",
					kind: "chat",
					chatPlan: "starter",
					chatPlanCreditsLimit: "0.02",
					chatPlanCreditsUsed: "0.00",
				})
				.where(eq(organization.id, testOrg.id));

			await db.insert(log).values({
				requestId: "test-request-chat-overage-balance",
				organizationId: testOrg.id,
				projectId: testProject.id,
				apiKeyId: testApiKey.id,
				cost: 0.05,
				cached: false,
				usedMode: "credits",
				duration: 1000,
				requestedModel: "openai/gpt-4o-mini",
				requestedProvider: "openai",
				usedModel: "gpt-4o-mini",
				usedProvider: "openai",
				responseSize: 100,
				mode: "credits",
			});

			await batchProcessLogs();

			const updatedOrg = await db.query.organization.findFirst({
				where: { id: { eq: testOrg.id } },
			});

			expect(Number(updatedOrg!.chatPlanCreditsUsed)).toBeCloseTo(0.02, 10);
			expect(Number(updatedOrg!.credits)).toBeCloseTo(0.97, 10);
		});
	});
});
