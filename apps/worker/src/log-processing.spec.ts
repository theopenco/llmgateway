import { randomUUID } from "node:crypto";

import { afterAll, beforeEach, describe, expect, test } from "vitest";

import {
	eq,
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
});
