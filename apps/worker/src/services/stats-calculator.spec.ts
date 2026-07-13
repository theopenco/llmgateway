import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
	db,
	provider,
	model,
	modelProviderMapping,
	modelProviderMappingHistory,
	modelHistory,
	modelProviderMappingHistoryHourly,
	modelHistoryHourly,
	log,
	organization,
	project,
	apiKey,
	eq,
	and,
	user,
} from "@llmgateway/db";

import {
	calculateMinutelyHistory,
	calculateAggregatedStatistics,
	calculateHourlyHistory,
	backfillHistoryIfNeeded,
	backfillHourlyHistoryIfNeeded,
} from "./stats-calculator.js";

// Mock current time for consistent testing
const mockDate = new Date("2024-01-01T12:30:00.000Z");

describe("stats-calculator", () => {
	beforeEach(async () => {
		// Mock Date to have consistent time-based tests
		vi.setSystemTime(mockDate);

		// Clean up test data before each test
		await db.delete(log);
		await db.delete(modelProviderMappingHistoryHourly);
		await db.delete(modelHistoryHourly);
		await db.delete(modelProviderMappingHistory);
		await db.delete(modelHistory);
		await db.delete(modelProviderMapping);
		await db.delete(model);
		await db.delete(provider);
		await db.delete(apiKey);
		await db.delete(project);
		await db.delete(organization);
		await db.delete(user);

		// Create test user
		const users = await db
			.insert(user)
			.values({
				email: "test@example.com",
				name: "Test User",
			})
			.returning();
		const testUser = users[0];

		// Set up basic test data - organization, project, api key first
		await db.insert(organization).values([
			{
				id: "org-1",
				name: "Test Organization",
				billingEmail: testUser.email,
			},
		]);

		await db.insert(project).values([
			{
				id: "proj-1",
				name: "Test Project",
				organizationId: "org-1",
			},
		]);

		await db.insert(apiKey).values([
			{
				id: "key-1",
				description: "Test API Key",
				token: "test-key",
				projectId: "proj-1",
				createdBy: testUser.id,
			},
		]);

		// Set up test providers
		await db.insert(provider).values([
			{
				id: "openai",
				name: "OpenAI",
				description: "OpenAI provider",
				streaming: true,
				cancellation: false,
				color: "#ffffff",
				website: "https://openai.com",
				status: "active",
			},
			{
				id: "anthropic",
				name: "Anthropic",
				description: "Anthropic provider",
				streaming: true,
				cancellation: false,
				color: "#000000",
				website: "https://anthropic.com",
				status: "active",
			},
		]);

		// Set up test models
		await db.insert(model).values([
			{
				id: "gpt-4",
				name: "GPT-4",
				family: "gpt",
				status: "active",
			},
			{
				id: "claude-3-5-sonnet",
				name: "Claude 3.5 Sonnet",
				family: "claude",
				status: "active",
			},
		]);

		// Set up model-provider mappings
		await db.insert(modelProviderMapping).values([
			{
				id: "mapping-1",
				modelId: "gpt-4",
				providerId: "openai",
				externalId: "gpt-4",
				status: "active",
			},
			{
				id: "mapping-2",
				modelId: "claude-3-5-sonnet",
				providerId: "anthropic",
				externalId: "claude-3-5-sonnet-20241022",
				status: "active",
			},
		]);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	describe("calculateMinutelyHistory", () => {
		it("should calculate minutely statistics for model-provider mappings", async () => {
			// Insert test logs for the previous minute (12:29-12:30)
			const previousMinuteStart = new Date("2024-01-01T12:29:00.000Z");

			await db.insert(log).values([
				{
					id: "log-1",
					requestId: "req-1",
					organizationId: "org-1",
					projectId: "proj-1",
					apiKeyId: "key-1",
					duration: 1000,
					requestedModel: "gpt-4",
					requestedProvider: "openai",
					usedModel: "openai/gpt-4",
					usedProvider: "openai",
					responseSize: 100,
					hasError: false,
					promptTokens: "80",
					completionTokens: "100",
					totalTokens: "180",
					reasoningTokens: "10",
					cachedTokens: "5",
					unifiedFinishReason: "completed",
					mode: "api-keys",
					usedMode: "api-keys",
					createdAt: new Date(previousMinuteStart.getTime() + 30000), // 30 seconds in
				},
				{
					id: "log-2",
					requestId: "req-2",
					organizationId: "org-1",
					projectId: "proj-1",
					apiKeyId: "key-1",
					duration: 2000,
					requestedModel: "gpt-4",
					requestedProvider: "openai",
					usedModel: "openai/gpt-4",
					usedProvider: "openai",
					responseSize: 50,
					hasError: true,
					promptTokens: "60",
					completionTokens: "50",
					totalTokens: "110",
					reasoningTokens: "8",
					cachedTokens: "3",
					unifiedFinishReason: "upstream_error",
					mode: "api-keys",
					usedMode: "api-keys",
					createdAt: new Date(previousMinuteStart.getTime() + 45000), // 45 seconds in
				},
				{
					id: "log-3",
					requestId: "req-3",
					organizationId: "org-1",
					projectId: "proj-1",
					apiKeyId: "key-1",
					duration: 1500,
					requestedModel: "claude-3-5-sonnet",
					requestedProvider: "anthropic",
					usedModel: "anthropic/claude-3-5-sonnet",
					usedProvider: "anthropic",
					responseSize: 200,
					hasError: false,
					promptTokens: "120",
					completionTokens: "200",
					totalTokens: "320",
					reasoningTokens: "15",
					cachedTokens: "0",
					unifiedFinishReason: "completed",
					mode: "api-keys",
					usedMode: "api-keys",
					createdAt: new Date(previousMinuteStart.getTime() + 30000), // 30 seconds in
				},
			]);

			await calculateMinutelyHistory();

			// Check that history records were created
			const historyRecords = await db
				.select()
				.from(modelProviderMappingHistory);

			expect(historyRecords).toHaveLength(2);

			// Check OpenAI GPT-4 record
			const gptRecord = historyRecords.find(
				(r) => r.modelId === "gpt-4" && r.providerId === "openai",
			);
			expect(gptRecord).toBeTruthy();
			expect(gptRecord?.logsCount).toBe(2);
			expect(gptRecord?.errorsCount).toBe(1);
			expect(gptRecord?.clientErrorsCount).toBe(0);
			expect(gptRecord?.gatewayErrorsCount).toBe(0);
			expect(gptRecord?.upstreamErrorsCount).toBe(1); // One upstream error
			expect(gptRecord?.totalInputTokens).toBe(140); // 80 + 60
			expect(gptRecord?.totalOutputTokens).toBe(150); // 100 + 50
			expect(gptRecord?.totalTokens).toBe(290); // 180 + 110
			expect(gptRecord?.totalReasoningTokens).toBe(18); // 10 + 8
			expect(gptRecord?.totalCachedTokens).toBe(8); // 5 + 3
			expect(gptRecord?.totalDuration).toBe(3000); // 1000 + 2000
			expect(gptRecord?.cachedCount).toBe(0); // No cached requests for gpt-4
			expect(gptRecord?.minuteTimestamp).toEqual(previousMinuteStart);

			// Check Anthropic Claude record
			const claudeRecord = historyRecords.find(
				(r) =>
					r.modelId === "claude-3-5-sonnet" && r.providerId === "anthropic",
			);
			expect(claudeRecord).toBeTruthy();
			expect(claudeRecord?.logsCount).toBe(1);
			expect(claudeRecord?.errorsCount).toBe(0);
			expect(claudeRecord?.clientErrorsCount).toBe(0);
			expect(claudeRecord?.gatewayErrorsCount).toBe(0);
			expect(claudeRecord?.upstreamErrorsCount).toBe(0);
			expect(claudeRecord?.totalInputTokens).toBe(120);
			expect(claudeRecord?.totalOutputTokens).toBe(200);
			expect(claudeRecord?.totalTokens).toBe(320);
			expect(claudeRecord?.totalReasoningTokens).toBe(15);
			expect(claudeRecord?.totalCachedTokens).toBe(0);
			expect(claudeRecord?.totalDuration).toBe(1500);
			expect(claudeRecord?.cachedCount).toBe(0); // No cached requests for claude
		});

		it("should attribute region-suffixed logs to the matching regional mappings", async () => {
			const previousMinuteStart = new Date("2024-01-01T12:29:00.000Z");

			await db.insert(provider).values({
				id: "alibaba",
				name: "Alibaba",
				description: "Alibaba provider",
				streaming: true,
				cancellation: false,
				color: "#ff6a00",
				website: "https://www.alibabacloud.com",
				status: "active",
			});

			await db.insert(model).values({
				id: "deepseek-v3.2",
				name: "DeepSeek V3.2",
				family: "deepseek",
				status: "active",
			});

			await db.insert(modelProviderMapping).values([
				{
					id: "mapping-aggregate",
					modelId: "deepseek-v3.2",
					providerId: "alibaba",
					externalId: "deepseek-v3.2",
					status: "active",
				},
				{
					id: "mapping-3",
					modelId: "deepseek-v3.2",
					providerId: "alibaba",
					externalId: "deepseek-v3.2:singapore",
					region: "singapore",
					status: "active",
				},
				{
					id: "mapping-4",
					modelId: "deepseek-v3.2",
					providerId: "alibaba",
					externalId: "deepseek-v3.2:cn-beijing",
					region: "cn-beijing",
					status: "active",
				},
			]);

			await db.insert(log).values([
				{
					id: "log-region-1",
					requestId: "req-region-1",
					organizationId: "org-1",
					projectId: "proj-1",
					apiKeyId: "key-1",
					duration: 1200,
					requestedModel: "alibaba/deepseek-v3.2:singapore",
					requestedProvider: "alibaba",
					usedModel: "alibaba/deepseek-v3.2:singapore",
					usedProvider: "alibaba",
					responseSize: 100,
					hasError: false,
					promptTokens: "100",
					completionTokens: "80",
					totalTokens: "180",
					cost: 0.12,
					unifiedFinishReason: "completed",
					mode: "api-keys",
					usedMode: "api-keys",
					createdAt: new Date(previousMinuteStart.getTime() + 10000),
				},
				{
					id: "log-region-2",
					requestId: "req-region-2",
					organizationId: "org-1",
					projectId: "proj-1",
					apiKeyId: "key-1",
					duration: 1500,
					requestedModel: "alibaba/deepseek-v3.2:cn-beijing",
					requestedProvider: "alibaba",
					usedModel: "alibaba/deepseek-v3.2:cn-beijing",
					usedProvider: "alibaba",
					responseSize: 120,
					hasError: false,
					promptTokens: "120",
					completionTokens: "90",
					totalTokens: "210",
					cost: 0.21,
					unifiedFinishReason: "completed",
					mode: "api-keys",
					usedMode: "api-keys",
					createdAt: new Date(previousMinuteStart.getTime() + 20000),
				},
			]);

			await calculateMinutelyHistory();

			const deepseekHistory = (await db.select().from(modelHistory)).find(
				(record) => record.modelId === "deepseek-v3.2",
			);

			expect(deepseekHistory).toBeTruthy();
			expect(deepseekHistory?.logsCount).toBe(2);
			expect(deepseekHistory?.totalInputTokens).toBe(220);
			expect(deepseekHistory?.totalOutputTokens).toBe(170);
			expect(deepseekHistory?.totalCost).toBeCloseTo(0.33);

			const regionHistory = await db.select().from(modelProviderMappingHistory);
			const aggregateHistory = regionHistory.find(
				(record) => record.modelProviderMappingId === "mapping-aggregate",
			);
			const singaporeHistory = regionHistory.find(
				(record) => record.modelProviderMappingId === "mapping-3",
			);
			const beijingHistory = regionHistory.find(
				(record) => record.modelProviderMappingId === "mapping-4",
			);

			expect(aggregateHistory).toBeTruthy();
			expect(aggregateHistory?.logsCount).toBe(2);
			expect(aggregateHistory?.totalInputTokens).toBe(220);
			expect(aggregateHistory?.totalOutputTokens).toBe(170);
			expect(aggregateHistory?.totalCost).toBeCloseTo(0.33);

			expect(singaporeHistory).toBeTruthy();
			expect(singaporeHistory?.logsCount).toBe(1);
			expect(singaporeHistory?.totalInputTokens).toBe(100);
			expect(singaporeHistory?.totalOutputTokens).toBe(80);
			expect(singaporeHistory?.totalCost).toBeCloseTo(0.12);

			expect(beijingHistory).toBeTruthy();
			expect(beijingHistory?.logsCount).toBe(1);
			expect(beijingHistory?.totalInputTokens).toBe(120);
			expect(beijingHistory?.totalOutputTokens).toBe(90);
			expect(beijingHistory?.totalCost).toBeCloseTo(0.21);
		});

		it("should exclude same-provider recovered retries from health stats", async () => {
			const previousMinuteStart = new Date("2024-01-01T12:29:00.000Z");

			await db.insert(modelProviderMapping).values({
				id: "mapping-3",
				modelId: "gpt-4",
				providerId: "anthropic",
				externalId: "gpt-4-on-anthropic",
				status: "active",
			});

			await db.insert(log).values([
				{
					id: "log-same-provider-failed",
					requestId: "req-same-provider",
					organizationId: "org-1",
					projectId: "proj-1",
					apiKeyId: "key-1",
					duration: 600,
					requestedModel: "gpt-4",
					requestedProvider: "openai",
					usedModel: "openai/gpt-4",
					usedProvider: "openai",
					responseSize: 0,
					hasError: true,
					unifiedFinishReason: "upstream_error",
					mode: "api-keys",
					usedMode: "api-keys",
					retried: true,
					retriedByLogId: "log-same-provider-success",
					createdAt: new Date(previousMinuteStart.getTime() + 5000),
				},
				{
					id: "log-same-provider-success",
					requestId: "req-same-provider",
					organizationId: "org-1",
					projectId: "proj-1",
					apiKeyId: "key-1",
					duration: 1000,
					requestedModel: "gpt-4",
					requestedProvider: "openai",
					usedModel: "openai/gpt-4",
					usedProvider: "openai",
					responseSize: 120,
					hasError: false,
					promptTokens: "80",
					completionTokens: "100",
					totalTokens: "180",
					unifiedFinishReason: "completed",
					mode: "api-keys",
					usedMode: "api-keys",
					createdAt: new Date(previousMinuteStart.getTime() + 10000),
				},
				{
					id: "log-provider-fallback-failed",
					requestId: "req-provider-fallback",
					organizationId: "org-1",
					projectId: "proj-1",
					apiKeyId: "key-1",
					duration: 700,
					requestedModel: "gpt-4",
					requestedProvider: "openai",
					usedModel: "openai/gpt-4",
					usedProvider: "openai",
					responseSize: 0,
					hasError: true,
					unifiedFinishReason: "upstream_error",
					mode: "api-keys",
					usedMode: "api-keys",
					retried: true,
					retriedByLogId: "log-provider-fallback-success",
					createdAt: new Date(previousMinuteStart.getTime() + 15000),
				},
				{
					id: "log-provider-fallback-success",
					requestId: "req-provider-fallback",
					organizationId: "org-1",
					projectId: "proj-1",
					apiKeyId: "key-1",
					duration: 900,
					requestedModel: "gpt-4",
					requestedProvider: "openai",
					usedModel: "anthropic/gpt-4",
					usedProvider: "anthropic",
					responseSize: 140,
					hasError: false,
					promptTokens: "70",
					completionTokens: "120",
					totalTokens: "190",
					unifiedFinishReason: "completed",
					mode: "api-keys",
					usedMode: "api-keys",
					createdAt: new Date(previousMinuteStart.getTime() + 20000),
				},
			]);

			await calculateMinutelyHistory();
			await calculateAggregatedStatistics();

			const mappingHistoryRecords = await db
				.select()
				.from(modelProviderMappingHistory)
				.where(
					eq(modelProviderMappingHistory.minuteTimestamp, previousMinuteStart),
				);
			const openaiHistory = mappingHistoryRecords.find(
				(record) => record.modelProviderMappingId === "mapping-1",
			);
			const anthropicHistory = mappingHistoryRecords.find(
				(record) => record.modelProviderMappingId === "mapping-3",
			);

			expect(openaiHistory?.logsCount).toBe(2);
			expect(openaiHistory?.errorsCount).toBe(1);
			expect(anthropicHistory?.logsCount).toBe(1);
			expect(anthropicHistory?.errorsCount).toBe(0);

			const gpt4ModelHistory = (await db.select().from(modelHistory)).find(
				(record) =>
					record.modelId === "gpt-4" &&
					record.minuteTimestamp.getTime() === previousMinuteStart.getTime(),
			);
			expect(gpt4ModelHistory?.logsCount).toBe(3);
			expect(gpt4ModelHistory?.errorsCount).toBe(1);

			const mappings = await db
				.select()
				.from(modelProviderMapping)
				.where(eq(modelProviderMapping.modelId, "gpt-4"));
			const openaiMapping = mappings.find(
				(mapping) => mapping.id === "mapping-1",
			);
			const anthropicMapping = mappings.find(
				(mapping) => mapping.id === "mapping-3",
			);

			expect(openaiMapping).toBeDefined();
			expect(anthropicMapping).toBeDefined();
		});

		it("should keep failed regional attempts in mapping stats when recovery switches regions", async () => {
			const previousMinuteStart = new Date("2024-01-01T12:29:00.000Z");

			await db.insert(provider).values({
				id: "alibaba",
				name: "Alibaba",
				description: "Alibaba provider",
				streaming: true,
				cancellation: false,
				color: "#ff6a00",
				website: "https://www.alibabacloud.com",
				status: "active",
			});

			await db.insert(model).values({
				id: "deepseek-v3.2",
				name: "DeepSeek V3.2",
				family: "deepseek",
				status: "active",
			});

			await db.insert(modelProviderMapping).values([
				{
					id: "mapping-aggregate-region-retry",
					modelId: "deepseek-v3.2",
					providerId: "alibaba",
					externalId: "deepseek-v3.2",
					status: "active",
				},
				{
					id: "mapping-region-singapore",
					modelId: "deepseek-v3.2",
					providerId: "alibaba",
					externalId: "deepseek-v3.2:singapore",
					region: "singapore",
					status: "active",
				},
				{
					id: "mapping-region-beijing",
					modelId: "deepseek-v3.2",
					providerId: "alibaba",
					externalId: "deepseek-v3.2:cn-beijing",
					region: "cn-beijing",
					status: "active",
				},
			]);

			await db.insert(log).values([
				{
					id: "log-region-retry-failed",
					requestId: "req-region-retry",
					organizationId: "org-1",
					projectId: "proj-1",
					apiKeyId: "key-1",
					duration: 600,
					requestedModel: "alibaba/deepseek-v3.2",
					requestedProvider: "alibaba",
					usedModel: "alibaba/deepseek-v3.2:singapore",
					usedProvider: "alibaba",
					responseSize: 0,
					hasError: true,
					unifiedFinishReason: "upstream_error",
					mode: "api-keys",
					usedMode: "api-keys",
					retried: true,
					retriedByLogId: "log-region-retry-success",
					createdAt: new Date(previousMinuteStart.getTime() + 5000),
				},
				{
					id: "log-region-retry-success",
					requestId: "req-region-retry",
					organizationId: "org-1",
					projectId: "proj-1",
					apiKeyId: "key-1",
					duration: 900,
					requestedModel: "alibaba/deepseek-v3.2",
					requestedProvider: "alibaba",
					usedModel: "alibaba/deepseek-v3.2:cn-beijing",
					usedProvider: "alibaba",
					responseSize: 140,
					hasError: false,
					promptTokens: "70",
					completionTokens: "120",
					totalTokens: "190",
					unifiedFinishReason: "completed",
					mode: "api-keys",
					usedMode: "api-keys",
					createdAt: new Date(previousMinuteStart.getTime() + 10000),
				},
			]);

			await calculateMinutelyHistory();
			await calculateAggregatedStatistics();

			const mappingHistoryRecords = await db
				.select()
				.from(modelProviderMappingHistory)
				.where(
					eq(modelProviderMappingHistory.minuteTimestamp, previousMinuteStart),
				);
			const aggregateHistory = mappingHistoryRecords.find(
				(record) =>
					record.modelProviderMappingId === "mapping-aggregate-region-retry",
			);
			const singaporeHistory = mappingHistoryRecords.find(
				(record) =>
					record.modelProviderMappingId === "mapping-region-singapore",
			);
			const beijingHistory = mappingHistoryRecords.find(
				(record) => record.modelProviderMappingId === "mapping-region-beijing",
			);

			expect(aggregateHistory?.logsCount).toBe(2);
			expect(aggregateHistory?.errorsCount).toBe(1);
			expect(singaporeHistory?.logsCount).toBe(1);
			expect(singaporeHistory?.errorsCount).toBe(1);
			expect(beijingHistory?.logsCount).toBe(1);
			expect(beijingHistory?.errorsCount).toBe(0);

			const regionalMappings = await db
				.select()
				.from(modelProviderMapping)
				.where(eq(modelProviderMapping.modelId, "deepseek-v3.2"));
			const singaporeMapping = regionalMappings.find(
				(mapping) => mapping.id === "mapping-region-singapore",
			);
			const beijingMapping = regionalMappings.find(
				(mapping) => mapping.id === "mapping-region-beijing",
			);

			expect(singaporeMapping).toBeDefined();
			expect(beijingMapping).toBeDefined();

			const deepseekModelHistory = (await db.select().from(modelHistory)).find(
				(record) =>
					record.modelId === "deepseek-v3.2" &&
					record.minuteTimestamp.getTime() === previousMinuteStart.getTime(),
			);
			expect(deepseekModelHistory?.logsCount).toBe(2);
			expect(deepseekModelHistory?.errorsCount).toBe(1);
		});

		it("should keep failed attempts when the same-provider retry also failed", async () => {
			const previousMinuteStart = new Date("2024-01-01T12:29:00.000Z");

			await db.insert(log).values([
				{
					id: "log-same-provider-failed-1",
					requestId: "req-same-provider-all-failed",
					organizationId: "org-1",
					projectId: "proj-1",
					apiKeyId: "key-1",
					duration: 600,
					requestedModel: "gpt-4",
					requestedProvider: "openai",
					usedModel: "openai/gpt-4",
					usedProvider: "openai",
					responseSize: 0,
					hasError: true,
					unifiedFinishReason: "upstream_error",
					mode: "api-keys",
					usedMode: "api-keys",
					retried: true,
					retriedByLogId: "log-same-provider-failed-2",
					createdAt: new Date(previousMinuteStart.getTime() + 5000),
				},
				{
					id: "log-same-provider-failed-2",
					requestId: "req-same-provider-all-failed",
					organizationId: "org-1",
					projectId: "proj-1",
					apiKeyId: "key-1",
					duration: 700,
					requestedModel: "gpt-4",
					requestedProvider: "openai",
					usedModel: "openai/gpt-4",
					usedProvider: "openai",
					responseSize: 0,
					hasError: true,
					unifiedFinishReason: "upstream_error",
					mode: "api-keys",
					usedMode: "api-keys",
					createdAt: new Date(previousMinuteStart.getTime() + 10000),
				},
			]);

			await calculateMinutelyHistory();

			const mappingHistoryRecords = await db
				.select()
				.from(modelProviderMappingHistory)
				.where(
					eq(modelProviderMappingHistory.minuteTimestamp, previousMinuteStart),
				);
			const openaiHistory = mappingHistoryRecords.find(
				(record) => record.modelProviderMappingId === "mapping-1",
			);

			expect(openaiHistory?.logsCount).toBe(2);
			expect(openaiHistory?.errorsCount).toBe(2);

			const gpt4ModelHistory = (await db.select().from(modelHistory)).find(
				(record) =>
					record.modelId === "gpt-4" &&
					record.minuteTimestamp.getTime() === previousMinuteStart.getTime(),
			);
			expect(gpt4ModelHistory?.logsCount).toBe(2);
			expect(gpt4ModelHistory?.errorsCount).toBe(2);
		});

		it("should handle cached requests correctly by ignoring tokens but counting requests", async () => {
			const previousMinuteStart = new Date("2024-01-01T12:29:00.000Z");

			// Insert mix of cached and non-cached logs
			await db.insert(log).values([
				{
					id: "log-1",
					requestId: "req-1",
					organizationId: "org-1",
					projectId: "proj-1",
					apiKeyId: "key-1",
					duration: 1000,
					requestedModel: "gpt-4",
					requestedProvider: "openai",
					usedModel: "openai/gpt-4",
					usedProvider: "openai",
					responseSize: 100,
					hasError: false,
					unifiedFinishReason: "completed",
					promptTokens: "80",
					completionTokens: "100",
					totalTokens: "180",
					reasoningTokens: "10",
					cachedTokens: "5",
					cached: false, // Not cached
					mode: "hybrid",
					usedMode: "api-keys",
					createdAt: previousMinuteStart,
				},
				{
					id: "log-2",
					requestId: "req-2",
					organizationId: "org-1",
					projectId: "proj-1",
					apiKeyId: "key-1",
					duration: 500,
					requestedModel: "gpt-4",
					requestedProvider: "openai",
					usedModel: "openai/gpt-4",
					usedProvider: "openai",
					responseSize: 50,
					hasError: false,
					unifiedFinishReason: "completed",
					promptTokens: "60",
					completionTokens: "50",
					totalTokens: "110",
					reasoningTokens: "8",
					cachedTokens: "3",
					cached: true, // Cached - tokens should be ignored
					mode: "hybrid",
					usedMode: "api-keys",
					createdAt: previousMinuteStart,
				},
			]);

			await calculateMinutelyHistory();

			const historyRecords = await db
				.select()
				.from(modelProviderMappingHistory)
				.where(
					eq(modelProviderMappingHistory.minuteTimestamp, previousMinuteStart),
				);

			// Should have record for our openai/gpt-4 mapping only
			const openaiRecord = historyRecords.find(
				(r) => r.modelId === "gpt-4" && r.providerId === "openai",
			);
			expect(openaiRecord).toBeTruthy();
			const record = openaiRecord!;

			// Check that we count all logs
			expect(record.logsCount).toBe(2); // Both cached and non-cached
			expect(record.cachedCount).toBe(1); // Only one cached request

			// Check that tokens only include non-cached requests
			expect(record.totalInputTokens).toBe(80); // Only from log-1 (non-cached)
			expect(record.totalOutputTokens).toBe(100); // Only from log-1 (non-cached)
			expect(record.totalTokens).toBe(180); // Only from log-1 (non-cached)
			expect(record.totalReasoningTokens).toBe(10); // Only from log-1 (non-cached)
			expect(record.totalCachedTokens).toBe(5); // Only from log-1 (non-cached)
		});

		it("should skip logs with non-existent models or providers", async () => {
			const previousMinuteStart = new Date("2024-01-01T12:29:00.000Z");

			// Insert log with non-existent model/provider
			await db.insert(log).values([
				{
					id: "log-1",
					requestId: "req-1",
					organizationId: "org-1",
					projectId: "proj-1",
					apiKeyId: "key-1",
					duration: 1000,
					requestedModel: "non-existent-model",
					requestedProvider: "non-existent-provider",
					usedModel: "non-existent-model",
					usedProvider: "non-existent-provider",
					responseSize: 100,
					hasError: false,
					completionTokens: "100",
					mode: "api-keys",
					usedMode: "api-keys",
					createdAt: new Date(previousMinuteStart.getTime() + 30000),
				},
			]);

			await calculateMinutelyHistory();

			// Should create history records for existing mappings only, ignoring the invalid log
			const historyRecords = await db
				.select()
				.from(modelProviderMappingHistory);
			expect(historyRecords.length).toBeGreaterThanOrEqual(2); // Our test mappings

			// All should have zero stats since the log was for non-existent model/provider
			for (const record of historyRecords) {
				expect(record.logsCount).toBe(0);
				expect(record.totalOutputTokens).toBe(0);
			}
		});

		it("should handle empty logs gracefully", async () => {
			await calculateMinutelyHistory();

			// Should create history records for all mappings with zero stats
			const historyRecords = await db
				.select()
				.from(modelProviderMappingHistory);
			expect(historyRecords.length).toBeGreaterThanOrEqual(2); // Our test mappings

			// All should have zero stats since no logs were inserted
			for (const record of historyRecords) {
				expect(record.logsCount).toBe(0);
				expect(record.errorsCount).toBe(0);
				expect(record.totalOutputTokens).toBe(0);
				expect(record.totalDuration).toBe(0);
				expect(record.cachedCount).toBe(0);
			}
		});

		it("should update existing history records on conflict", async () => {
			const previousMinuteStart = new Date("2024-01-01T12:29:00.000Z");

			// Create initial history record
			await db.insert(modelProviderMappingHistory).values({
				modelId: "gpt-4",
				providerId: "openai",
				modelProviderMappingId: "mapping-1",
				minuteTimestamp: previousMinuteStart,
				logsCount: 1,
				errorsCount: 0,
				cachedCount: 0,
				totalOutputTokens: 50,
				totalDuration: 1000,
			});

			// Insert new log for the same minute
			await db.insert(log).values([
				{
					id: "log-1",
					requestId: "req-1",
					organizationId: "org-1",
					projectId: "proj-1",
					apiKeyId: "key-1",
					duration: 1000,
					requestedModel: "gpt-4",
					requestedProvider: "openai",
					usedModel: "openai/gpt-4",
					usedProvider: "openai",
					responseSize: 100,
					hasError: false,
					completionTokens: "100",
					mode: "api-keys",
					usedMode: "api-keys",
					createdAt: new Date(previousMinuteStart.getTime() + 30000),
				},
			]);

			await calculateMinutelyHistory();

			// Should have records for both mappings (including inactive one)
			const historyRecords = await db
				.select()
				.from(modelProviderMappingHistory);
			expect(historyRecords.length).toBeGreaterThanOrEqual(2); // At least the 2 test mappings

			// Check the active mapping was updated
			const gptRecord = historyRecords.find(
				(r) => r.modelId === "gpt-4" && r.providerId === "openai",
			);
			expect(gptRecord).toBeTruthy();
			expect(gptRecord?.logsCount).toBe(1);
			expect(gptRecord?.totalOutputTokens).toBe(100);

			// Check inactive mapping has zero stats
			const claudeRecord = historyRecords.find(
				(r) =>
					r.modelId === "claude-3-5-sonnet" && r.providerId === "anthropic",
			);
			expect(claudeRecord).toBeTruthy();
			expect(claudeRecord?.logsCount).toBe(0);
			expect(claudeRecord?.totalOutputTokens).toBe(0);

			// Check that model history was also created
			const modelHistoryRecords = await db.select().from(modelHistory);
			expect(modelHistoryRecords.length).toBeGreaterThanOrEqual(2); // At least 2 models

			const gptModelRecord = modelHistoryRecords.find(
				(r) => r.modelId === "gpt-4",
			);
			expect(gptModelRecord).toBeTruthy();
			expect(gptModelRecord?.logsCount).toBe(1); // Only one log in this test
			expect(gptModelRecord?.totalOutputTokens).toBe(100); // Only 100 tokens

			const claudeModelRecord = modelHistoryRecords.find(
				(r) => r.modelId === "claude-3-5-sonnet",
			);
			expect(claudeModelRecord).toBeTruthy();
			expect(claudeModelRecord?.logsCount).toBe(0); // No logs for claude in this test
			expect(claudeModelRecord?.totalOutputTokens).toBe(0);
		});

		it("should create entries for inactive model-provider mappings", async () => {
			// Don't insert any logs, so all mappings should be inactive

			await calculateMinutelyHistory();

			// Should create history records for all model-provider mappings
			const historyRecords = await db
				.select()
				.from(modelProviderMappingHistory);
			expect(historyRecords.length).toBeGreaterThanOrEqual(2); // At least our 2 test mappings

			// All should have zero stats since no logs were inserted
			for (const record of historyRecords) {
				expect(record.logsCount).toBe(0);
				expect(record.errorsCount).toBe(0);
				expect(record.totalOutputTokens).toBe(0);
				expect(record.totalDuration).toBe(0);
				expect(record.cachedCount).toBe(0);
			}

			// Check model history was also created with zero stats
			const modelHistoryRecords = await db.select().from(modelHistory);
			expect(modelHistoryRecords.length).toBeGreaterThanOrEqual(2); // At least our 2 test models

			for (const record of modelHistoryRecords) {
				expect(record.logsCount).toBe(0);
				expect(record.errorsCount).toBe(0);
				expect(record.totalOutputTokens).toBe(0);
				expect(record.totalDuration).toBe(0);
				expect(record.cachedCount).toBe(0);
			}
		});
	});

	describe("model history tracking", () => {
		it("should create model history records aggregated across all providers", async () => {
			// Insert test logs using both providers for the same model
			const previousMinuteStart = new Date("2024-01-01T12:29:00.000Z");

			// Add a second mapping for the same model with different provider
			await db.insert(modelProviderMapping).values([
				{
					id: "mapping-3",
					modelId: "gpt-4", // Same model, different provider
					providerId: "anthropic", // Using anthropic as second provider for gpt-4
					externalId: "gpt-4-on-anthropic",
					status: "active",
				},
			]);

			await db.insert(log).values([
				{
					id: "log-1",
					requestId: "req-1",
					organizationId: "org-1",
					projectId: "proj-1",
					apiKeyId: "key-1",
					duration: 1000,
					requestedModel: "gpt-4",
					requestedProvider: "openai",
					usedModel: "openai/gpt-4",
					usedProvider: "openai",
					responseSize: 100,
					hasError: false,
					completionTokens: "100",
					mode: "api-keys",
					usedMode: "api-keys",
					createdAt: new Date(previousMinuteStart.getTime() + 30000),
				},
				{
					id: "log-2",
					requestId: "req-2",
					organizationId: "org-1",
					projectId: "proj-1",
					apiKeyId: "key-1",
					duration: 2000,
					requestedModel: "gpt-4",
					requestedProvider: "anthropic",
					usedModel: "anthropic/gpt-4", // Must match usedProvider for correct stats tracking
					usedProvider: "anthropic",
					responseSize: 150,
					hasError: true,
					completionTokens: "200",
					mode: "api-keys",
					usedMode: "api-keys",
					createdAt: new Date(previousMinuteStart.getTime() + 45000),
				},
			]);

			await calculateMinutelyHistory();

			// Check model history aggregates across providers
			const modelHistoryRecords = await db.select().from(modelHistory);
			const gptModelRecord = modelHistoryRecords.find(
				(r) => r.modelId === "gpt-4",
			);

			expect(gptModelRecord).toBeTruthy();
			expect(gptModelRecord?.logsCount).toBe(2); // Both logs combined
			expect(gptModelRecord?.errorsCount).toBe(1); // One error
			expect(gptModelRecord?.totalOutputTokens).toBe(300); // 100 + 200
			expect(gptModelRecord?.totalDuration).toBe(3000); // 1000 + 2000
			expect(gptModelRecord?.cachedCount).toBe(0); // No cached requests

			// Also check model-provider mappings are separate
			const mappingRecords = await db
				.select()
				.from(modelProviderMappingHistory);
			const openaiMapping = mappingRecords.find(
				(r) => r.modelId === "gpt-4" && r.providerId === "openai",
			);
			const anthropicMapping = mappingRecords.find(
				(r) => r.modelId === "gpt-4" && r.providerId === "anthropic",
			);

			expect(openaiMapping?.logsCount).toBe(1);
			expect(anthropicMapping?.logsCount).toBe(1);
		});

		it("should create model history entries for inactive models", async () => {
			// Don't insert any logs, so all models should have zero stats

			await calculateMinutelyHistory();

			const modelHistoryRecords = await db.select().from(modelHistory);
			expect(modelHistoryRecords.length).toBeGreaterThanOrEqual(2); // At least our 2 test models

			// All should have zero stats since no logs were inserted
			for (const record of modelHistoryRecords) {
				expect(record.logsCount).toBe(0);
				expect(record.errorsCount).toBe(0);
				expect(record.totalOutputTokens).toBe(0);
				expect(record.totalDuration).toBe(0);
				expect(record.cachedCount).toBe(0);
			}
		});

		it("should handle model history conflicts with upsert", async () => {
			const previousMinuteStart = new Date("2024-01-01T12:29:00.000Z");

			// Create initial model history record
			await db.insert(modelHistory).values({
				modelId: "gpt-4",
				minuteTimestamp: previousMinuteStart,
				logsCount: 1,
				errorsCount: 0,
				cachedCount: 0,
				totalOutputTokens: 50,
				totalDuration: 1000,
			});

			// Insert new log for the same minute
			await db.insert(log).values([
				{
					id: "log-1",
					requestId: "req-1",
					organizationId: "org-1",
					projectId: "proj-1",
					apiKeyId: "key-1",
					duration: 1000,
					requestedModel: "gpt-4",
					requestedProvider: "openai",
					usedModel: "openai/gpt-4",
					usedProvider: "openai",
					responseSize: 100,
					hasError: false,
					completionTokens: "100",
					mode: "api-keys",
					usedMode: "api-keys",
					createdAt: new Date(previousMinuteStart.getTime() + 30000),
				},
			]);

			await calculateMinutelyHistory();

			const modelHistoryRecords = await db.select().from(modelHistory);
			const gptRecord = modelHistoryRecords.find((r) => r.modelId === "gpt-4");

			expect(gptRecord).toBeTruthy();
			expect(gptRecord?.logsCount).toBe(1); // Should be updated, not added to existing
			expect(gptRecord?.totalOutputTokens).toBe(100);
		});
	});

	describe("calculateAggregatedStatistics", () => {
		/** Helper to compute a Date N minutes before `now` without triggering no-mixed-operators. */
		function minutesAgo(now: Date, minutes: number): Date {
			const offsetMs = minutes * 60 * 1000;
			return new Date(now.getTime() - offsetMs);
		}

		it("should calculate and update provider statistics", async () => {
			const now = new Date("2024-01-01T12:30:00.000Z");

			await db.insert(modelProviderMappingHistory).values([
				{
					modelId: "gpt-4",
					providerId: "openai",
					modelProviderMappingId: "mapping-1",
					minuteTimestamp: minutesAgo(now, 4), // 4 minutes ago
					logsCount: 10,
					errorsCount: 1,
					cachedCount: 0,
				},
				{
					modelId: "gpt-4",
					providerId: "openai",
					modelProviderMappingId: "mapping-1",
					minuteTimestamp: minutesAgo(now, 3), // 3 minutes ago
					logsCount: 15,
					errorsCount: 2,
					cachedCount: 0,
				},
			]);

			await calculateAggregatedStatistics();

			// Check provider statistics were updated
			const providers = await db
				.select()
				.from(provider)
				.where(eq(provider.id, "openai"));

			expect(providers).toHaveLength(1);
			const openaiProvider = providers[0]!;
			expect(openaiProvider.logsCount).toBe(25); // 10 + 15
			expect(openaiProvider.errorsCount).toBe(3); // 1 + 2
			expect(openaiProvider.cachedCount).toBe(0);
			expect(openaiProvider.clientErrorsCount).toBe(0);
			expect(openaiProvider.gatewayErrorsCount).toBe(0);
			expect(openaiProvider.upstreamErrorsCount).toBe(0);
			expect(openaiProvider.statsUpdatedAt).not.toBeNull();
		});

		it("should calculate and update model statistics", async () => {
			const now = new Date("2024-01-01T12:30:00.000Z");

			await db.insert(modelProviderMappingHistory).values([
				{
					modelId: "gpt-4",
					providerId: "openai",
					modelProviderMappingId: "mapping-1",
					minuteTimestamp: minutesAgo(now, 4),
					logsCount: 20,
					errorsCount: 2,
					cachedCount: 0,
				},
			]);

			await calculateAggregatedStatistics();

			// Check model statistics were updated
			const models = await db.select().from(model).where(eq(model.id, "gpt-4"));

			expect(models).toHaveLength(1);
			const gptModel = models[0]!;
			expect(gptModel.logsCount).toBe(20);
			expect(gptModel.errorsCount).toBe(2);
			expect(gptModel.cachedCount).toBe(0);
			expect(gptModel.clientErrorsCount).toBe(0);
			expect(gptModel.gatewayErrorsCount).toBe(0);
			expect(gptModel.upstreamErrorsCount).toBe(0);
			expect(gptModel.statsUpdatedAt).not.toBeNull();
		});

		it("should calculate and update model-provider mapping statistics", async () => {
			const now = new Date("2024-01-01T12:30:00.000Z");

			await db.insert(modelProviderMappingHistory).values([
				{
					modelId: "gpt-4",
					providerId: "openai",
					modelProviderMappingId: "mapping-1",
					minuteTimestamp: minutesAgo(now, 4),
					logsCount: 30,
					errorsCount: 3,
					cachedCount: 0,
					totalOutputTokens: 600,
					totalDuration: 3000,
					totalTimeToFirstToken: 900,
					totalTimeToFirstReasoningToken: 0,
				},
			]);

			await calculateAggregatedStatistics();

			const mappings = await db
				.select()
				.from(modelProviderMapping)
				.where(
					and(
						eq(modelProviderMapping.modelId, "gpt-4"),
						eq(modelProviderMapping.providerId, "openai"),
					),
				);

			expect(mappings).toHaveLength(1);
			const mapping = mappings[0]!;
			expect(mapping.logsCount).toBe(30);
			expect(mapping.errorsCount).toBe(3);
			expect(mapping.cachedCount).toBe(0);
			expect(mapping.statsUpdatedAt).not.toBeNull();
		});

		it("should handle empty history data gracefully", async () => {
			await calculateAggregatedStatistics();

			const providers = await db.select().from(provider);
			expect(providers).toHaveLength(2); // Our test providers
		});

		it("should only process history from the last 60 minutes", async () => {
			const now = new Date("2024-01-01T12:30:00.000Z");

			// Insert old history data (> 60 min ago, should be ignored)
			await db.insert(modelProviderMappingHistory).values([
				{
					modelId: "gpt-4",
					providerId: "openai",
					modelProviderMappingId: "mapping-1",
					minuteTimestamp: minutesAgo(now, 90), // 90 min ago
					logsCount: 100,
					errorsCount: 10,
					cachedCount: 0,
				},
			]);

			await calculateAggregatedStatistics();

			// Provider statistics should not be updated with old data
			const providers = await db
				.select()
				.from(provider)
				.where(eq(provider.id, "openai"));

			expect(providers).toHaveLength(1);
			const openaiProvider = providers[0]!;
			expect(openaiProvider.logsCount).toBe(0); // Should remain 0
			expect(openaiProvider.statsUpdatedAt).toBeNull(); // Should not be updated
		});
	});

	describe("backfillHistoryIfNeeded", () => {
		it("should backfill when no history exists", async () => {
			// Set time to 12:30 so we backfill from 12:25 to 12:29 (5 minutes)
			vi.setSystemTime(new Date("2024-01-01T12:30:00.000Z"));

			await backfillHistoryIfNeeded();

			const historyRecords = await db
				.select()
				.from(modelProviderMappingHistory);

			// Should have created history for 5 minutes (12:25-12:29) for 2 mappings = 10 records
			expect(historyRecords.length).toBeGreaterThanOrEqual(10);

			// Check that we have entries for each minute
			const timestamps = historyRecords.map((r) => r.minuteTimestamp.getTime());
			const uniqueTimestamps = new Set(timestamps);
			expect(uniqueTimestamps.size).toBe(5); // 5 different minutes

			// Check that model history was also backfilled
			const modelHistoryRecords = await db.select().from(modelHistory);
			// Should have created history for 5 minutes for 2 models = 10 records
			expect(modelHistoryRecords.length).toBeGreaterThanOrEqual(10);

			const modelTimestamps = modelHistoryRecords.map((r) =>
				r.minuteTimestamp.getTime(),
			);
			const uniqueModelTimestamps = new Set(modelTimestamps);
			expect(uniqueModelTimestamps.size).toBe(5); // 5 different minutes
		});

		it("should not backfill when history is up to date", async () => {
			// Create recent history entry
			const recentMinute = new Date("2024-01-01T12:28:00.000Z");
			await db.insert(modelProviderMappingHistory).values({
				modelId: "gpt-4",
				providerId: "openai",
				modelProviderMappingId: "mapping-1",
				minuteTimestamp: recentMinute,
				logsCount: 0,
				errorsCount: 0,
				cachedCount: 0,
				totalOutputTokens: 0,
				totalDuration: 0,
			});

			await backfillHistoryIfNeeded();

			const historyRecords = await db
				.select()
				.from(modelProviderMappingHistory);
			// Should only have the one we inserted, no backfill needed
			expect(historyRecords).toHaveLength(1);
		});

		it("should backfill missing periods", async () => {
			// Create old history entry from 5 minutes ago
			const oldMinute = new Date("2024-01-01T12:25:00.000Z");
			await db.insert(modelProviderMappingHistory).values({
				modelId: "gpt-4",
				providerId: "openai",
				modelProviderMappingId: "mapping-1",
				minuteTimestamp: oldMinute,
				logsCount: 5,
				errorsCount: 1,
				clientErrorsCount: 0,
				gatewayErrorsCount: 0,
				upstreamErrorsCount: 0,
				cachedCount: 0,
				totalInputTokens: 0,
				totalOutputTokens: 500,
				totalTokens: 0,
				totalReasoningTokens: 0,
				totalCachedTokens: 0,
				totalDuration: 2000,
			});

			await backfillHistoryIfNeeded();

			const historyRecords = await db
				.select()
				.from(modelProviderMappingHistory);

			// Should have backfilled 4 minutes (12:26-12:29) for 2 mappings = 8 new records + 1 existing = 9
			expect(historyRecords.length).toBeGreaterThanOrEqual(9);

			// Check we have entries for the missing minutes
			const timestamps = historyRecords.map((r) => r.minuteTimestamp);
			const sortedTimestamps = timestamps.sort(
				(a, b) => a.getTime() - b.getTime(),
			);

			expect(sortedTimestamps[0]?.getTime()).toBe(oldMinute.getTime());
			expect(sortedTimestamps[sortedTimestamps.length - 1]?.getTime()).toBe(
				new Date("2024-01-01T12:29:00.000Z").getTime(),
			);
		});
	});

	describe("calculateHourlyHistory", () => {
		// mockDate is 12:30Z → current hour 12:00, previous hour 11:00
		const currentHour = new Date("2024-01-01T12:00:00.000Z");
		const previousHour = new Date("2024-01-01T11:00:00.000Z");

		it("should roll up minute history into hourly summaries", async () => {
			await db.insert(modelHistory).values([
				{
					modelId: "gpt-4",
					minuteTimestamp: new Date("2024-01-01T12:05:00.000Z"),
					logsCount: 10,
					errorsCount: 1,
					cachedCount: 2,
					totalOutputTokens: 100,
					totalDuration: 1000,
				},
				{
					modelId: "gpt-4",
					minuteTimestamp: new Date("2024-01-01T12:15:00.000Z"),
					logsCount: 5,
					errorsCount: 0,
					cachedCount: 1,
					totalOutputTokens: 50,
					totalDuration: 500,
				},
				// Previous hour entry should roll up into the 11:00 bucket
				{
					modelId: "gpt-4",
					minuteTimestamp: new Date("2024-01-01T11:30:00.000Z"),
					logsCount: 7,
					errorsCount: 2,
					cachedCount: 0,
					totalOutputTokens: 70,
					totalDuration: 700,
				},
			]);

			await db.insert(modelProviderMappingHistory).values([
				{
					modelId: "gpt-4",
					providerId: "openai",
					modelProviderMappingId: "mapping-1",
					minuteTimestamp: new Date("2024-01-01T12:05:00.000Z"),
					logsCount: 10,
					errorsCount: 1,
					cachedCount: 2,
					totalOutputTokens: 100,
					totalDuration: 1000,
				},
				{
					modelId: "gpt-4",
					providerId: "openai",
					modelProviderMappingId: "mapping-1",
					minuteTimestamp: new Date("2024-01-01T12:15:00.000Z"),
					logsCount: 5,
					errorsCount: 0,
					cachedCount: 1,
					totalOutputTokens: 50,
					totalDuration: 500,
				},
			]);

			await calculateHourlyHistory();

			const modelHourly = await db.select().from(modelHistoryHourly);
			const gptCurrent = modelHourly.find(
				(r) =>
					r.modelId === "gpt-4" &&
					r.hourTimestamp.getTime() === currentHour.getTime(),
			);
			expect(gptCurrent?.logsCount).toBe(15);
			expect(gptCurrent?.errorsCount).toBe(1);
			expect(gptCurrent?.cachedCount).toBe(3);
			expect(gptCurrent?.totalOutputTokens).toBe(150);
			expect(gptCurrent?.totalDuration).toBe(1500);

			const gptPrevious = modelHourly.find(
				(r) =>
					r.modelId === "gpt-4" &&
					r.hourTimestamp.getTime() === previousHour.getTime(),
			);
			expect(gptPrevious?.logsCount).toBe(7);
			expect(gptPrevious?.errorsCount).toBe(2);

			const mappingHourly = await db
				.select()
				.from(modelProviderMappingHistoryHourly);
			const mappingCurrent = mappingHourly.find(
				(r) =>
					r.modelProviderMappingId === "mapping-1" &&
					r.hourTimestamp.getTime() === currentHour.getTime(),
			);
			expect(mappingCurrent?.modelId).toBe("gpt-4");
			expect(mappingCurrent?.providerId).toBe("openai");
			expect(mappingCurrent?.logsCount).toBe(15);
			expect(mappingCurrent?.cachedCount).toBe(3);
			expect(mappingCurrent?.totalOutputTokens).toBe(150);
		});

		it("should overwrite existing hourly rows rather than accumulate", async () => {
			// Pre-existing hourly row with stale values
			await db.insert(modelHistoryHourly).values({
				modelId: "gpt-4",
				hourTimestamp: currentHour,
				logsCount: 999,
				errorsCount: 999,
			});

			await db.insert(modelHistory).values({
				modelId: "gpt-4",
				minuteTimestamp: new Date("2024-01-01T12:05:00.000Z"),
				logsCount: 4,
				errorsCount: 1,
			});

			await calculateHourlyHistory();

			const modelHourly = await db.select().from(modelHistoryHourly);
			const gptCurrent = modelHourly.find(
				(r) =>
					r.modelId === "gpt-4" &&
					r.hourTimestamp.getTime() === currentHour.getTime(),
			);
			// Recomputed from minute data, not added to the stale 999
			expect(gptCurrent?.logsCount).toBe(4);
			expect(gptCurrent?.errorsCount).toBe(1);
		});

		it("should roll up token totals exceeding the 32-bit integer range", async () => {
			// Each minute fits in a 32-bit int, but the hourly sum (4e9) exceeds
			// 2,147,483,647, which would throw if the rollup narrowed tokens to int.
			const minuteTokens = 2_000_000_000;
			const hourTokens = minuteTokens * 2;

			await db.insert(modelHistory).values([
				{
					modelId: "gpt-4",
					minuteTimestamp: new Date("2024-01-01T12:05:00.000Z"),
					totalInputTokens: minuteTokens,
					totalOutputTokens: minuteTokens,
					totalTokens: minuteTokens,
					totalReasoningTokens: minuteTokens,
					totalCachedTokens: minuteTokens,
				},
				{
					modelId: "gpt-4",
					minuteTimestamp: new Date("2024-01-01T12:15:00.000Z"),
					totalInputTokens: minuteTokens,
					totalOutputTokens: minuteTokens,
					totalTokens: minuteTokens,
					totalReasoningTokens: minuteTokens,
					totalCachedTokens: minuteTokens,
				},
			]);

			await db.insert(modelProviderMappingHistory).values([
				{
					modelId: "gpt-4",
					providerId: "openai",
					modelProviderMappingId: "mapping-1",
					minuteTimestamp: new Date("2024-01-01T12:05:00.000Z"),
					totalInputTokens: minuteTokens,
					totalOutputTokens: minuteTokens,
					totalTokens: minuteTokens,
					totalReasoningTokens: minuteTokens,
					totalCachedTokens: minuteTokens,
				},
				{
					modelId: "gpt-4",
					providerId: "openai",
					modelProviderMappingId: "mapping-1",
					minuteTimestamp: new Date("2024-01-01T12:15:00.000Z"),
					totalInputTokens: minuteTokens,
					totalOutputTokens: minuteTokens,
					totalTokens: minuteTokens,
					totalReasoningTokens: minuteTokens,
					totalCachedTokens: minuteTokens,
				},
			]);

			await calculateHourlyHistory();

			const modelHourly = await db.select().from(modelHistoryHourly);
			const gptCurrent = modelHourly.find(
				(r) =>
					r.modelId === "gpt-4" &&
					r.hourTimestamp.getTime() === currentHour.getTime(),
			);
			expect(gptCurrent?.totalInputTokens).toBe(hourTokens);
			expect(gptCurrent?.totalOutputTokens).toBe(hourTokens);
			expect(gptCurrent?.totalTokens).toBe(hourTokens);
			expect(gptCurrent?.totalReasoningTokens).toBe(hourTokens);
			expect(gptCurrent?.totalCachedTokens).toBe(hourTokens);

			const mappingHourly = await db
				.select()
				.from(modelProviderMappingHistoryHourly);
			const mappingCurrent = mappingHourly.find(
				(r) =>
					r.modelProviderMappingId === "mapping-1" &&
					r.hourTimestamp.getTime() === currentHour.getTime(),
			);
			expect(mappingCurrent?.totalTokens).toBe(hourTokens);
			expect(mappingCurrent?.totalInputTokens).toBe(hourTokens);
		});
	});

	describe("backfillHourlyHistoryIfNeeded", () => {
		it("should backfill from the earliest minute entry when hourly is empty", async () => {
			// mockDate 12:30Z → previous complete hour is 11:00; current hour 12:00
			// is in progress and must NOT be produced by backfill.
			await db.insert(modelHistory).values([
				{
					modelId: "gpt-4",
					minuteTimestamp: new Date("2024-01-01T10:30:00.000Z"),
					logsCount: 3,
				},
				{
					modelId: "gpt-4",
					minuteTimestamp: new Date("2024-01-01T11:30:00.000Z"),
					logsCount: 7,
				},
			]);
			await db.insert(modelProviderMappingHistory).values([
				{
					modelId: "gpt-4",
					providerId: "openai",
					modelProviderMappingId: "mapping-1",
					minuteTimestamp: new Date("2024-01-01T10:30:00.000Z"),
					logsCount: 3,
				},
				{
					modelId: "gpt-4",
					providerId: "openai",
					modelProviderMappingId: "mapping-1",
					minuteTimestamp: new Date("2024-01-01T11:30:00.000Z"),
					logsCount: 7,
				},
			]);

			await backfillHourlyHistoryIfNeeded();

			const modelHourly = await db.select().from(modelHistoryHourly);
			const hours = modelHourly
				.map((r) => r.hourTimestamp.getTime())
				.sort((a, b) => a - b);
			expect(new Set(hours).size).toBe(2);
			expect(hours[0]).toBe(new Date("2024-01-01T10:00:00.000Z").getTime());
			expect(hours[1]).toBe(new Date("2024-01-01T11:00:00.000Z").getTime());

			const tenHour = modelHourly.find(
				(r) =>
					r.hourTimestamp.getTime() ===
					new Date("2024-01-01T10:00:00.000Z").getTime(),
			);
			expect(tenHour?.logsCount).toBe(3);
			const elevenHour = modelHourly.find(
				(r) =>
					r.hourTimestamp.getTime() ===
					new Date("2024-01-01T11:00:00.000Z").getTime(),
			);
			expect(elevenHour?.logsCount).toBe(7);

			// Current (in-progress) hour must not be backfilled
			const currentHourRow = modelHourly.find(
				(r) =>
					r.hourTimestamp.getTime() ===
					new Date("2024-01-01T12:00:00.000Z").getTime(),
			);
			expect(currentHourRow).toBeUndefined();
		});

		it("should resume from the shared latest hour when both tables are populated", async () => {
			// Both summary tables already finalized hour 10:00 (no minute data there,
			// so the overlap re-run must leave the row untouched).
			await db.insert(modelHistoryHourly).values({
				modelId: "gpt-4",
				hourTimestamp: new Date("2024-01-01T10:00:00.000Z"),
				logsCount: 99,
			});
			await db.insert(modelProviderMappingHistoryHourly).values({
				modelId: "gpt-4",
				providerId: "openai",
				modelProviderMappingId: "mapping-1",
				hourTimestamp: new Date("2024-01-01T10:00:00.000Z"),
				logsCount: 99,
			});

			// Minute data only in the 11:00 hour
			await db.insert(modelHistory).values({
				modelId: "gpt-4",
				minuteTimestamp: new Date("2024-01-01T11:30:00.000Z"),
				logsCount: 7,
			});

			await backfillHourlyHistoryIfNeeded();

			const modelHourly = await db.select().from(modelHistoryHourly);
			// Existing 10:00 row preserved (no minute data to recompute it from)
			const tenHour = modelHourly.find(
				(r) =>
					r.hourTimestamp.getTime() ===
					new Date("2024-01-01T10:00:00.000Z").getTime(),
			);
			expect(tenHour?.logsCount).toBe(99);
			const elevenHour = modelHourly.find(
				(r) =>
					r.hourTimestamp.getTime() ===
					new Date("2024-01-01T11:00:00.000Z").getTime(),
			);
			expect(elevenHour?.logsCount).toBe(7);
		});

		it("should fill an older gap even when a recent hour is already present", async () => {
			// Minute data spans hours 9, 10, 11 in both tables.
			for (const [minute, logsCount] of [
				[new Date("2024-01-01T09:30:00.000Z"), 2],
				[new Date("2024-01-01T10:30:00.000Z"), 3],
				[new Date("2024-01-01T11:30:00.000Z"), 7],
			] as const) {
				await db.insert(modelHistory).values({
					modelId: "gpt-4",
					minuteTimestamp: minute,
					logsCount,
				});
				await db.insert(modelProviderMappingHistory).values({
					modelId: "gpt-4",
					providerId: "openai",
					modelProviderMappingId: "mapping-1",
					minuteTimestamp: minute,
					logsCount,
				});
			}

			// The live minutely loop already wrote only the most recent completed
			// hour (11:00); hours 9 and 10 are an unfilled gap behind it.
			await db.insert(modelHistoryHourly).values({
				modelId: "gpt-4",
				hourTimestamp: new Date("2024-01-01T11:00:00.000Z"),
				logsCount: 999,
			});
			await db.insert(modelProviderMappingHistoryHourly).values({
				modelId: "gpt-4",
				providerId: "openai",
				modelProviderMappingId: "mapping-1",
				hourTimestamp: new Date("2024-01-01T11:00:00.000Z"),
				logsCount: 999,
			});

			await backfillHourlyHistoryIfNeeded();

			const modelHourly = await db.select().from(modelHistoryHourly);
			// The older gap (9:00, 10:00) must be filled...
			expect(
				modelHourly.find(
					(r) =>
						r.hourTimestamp.getTime() ===
						new Date("2024-01-01T09:00:00.000Z").getTime(),
				)?.logsCount,
			).toBe(2);
			expect(
				modelHourly.find(
					(r) =>
						r.hourTimestamp.getTime() ===
						new Date("2024-01-01T10:00:00.000Z").getTime(),
				)?.logsCount,
			).toBe(3);
			// ...while the already-present recent hour is left untouched.
			expect(
				modelHourly.find(
					(r) =>
						r.hourTimestamp.getTime() ===
						new Date("2024-01-01T11:00:00.000Z").getTime(),
				)?.logsCount,
			).toBe(999);
		});

		it("should heal a table left behind by a partial write", async () => {
			// Minute data exists in both tables for hours 10 and 11.
			for (const minute of [
				new Date("2024-01-01T10:30:00.000Z"),
				new Date("2024-01-01T11:30:00.000Z"),
			]) {
				const logsCount = minute.getUTCHours() === 10 ? 3 : 7;
				await db.insert(modelHistory).values({
					modelId: "gpt-4",
					minuteTimestamp: minute,
					logsCount,
				});
				await db.insert(modelProviderMappingHistory).values({
					modelId: "gpt-4",
					providerId: "openai",
					modelProviderMappingId: "mapping-1",
					minuteTimestamp: minute,
					logsCount,
				});
			}

			// Simulate a crash after the mapping rollup wrote hours 10 and 11 but
			// before the model rollup got past hour 10: the model table is behind.
			await db.insert(modelProviderMappingHistoryHourly).values([
				{
					modelId: "gpt-4",
					providerId: "openai",
					modelProviderMappingId: "mapping-1",
					hourTimestamp: new Date("2024-01-01T10:00:00.000Z"),
					logsCount: 3,
				},
				{
					modelId: "gpt-4",
					providerId: "openai",
					modelProviderMappingId: "mapping-1",
					hourTimestamp: new Date("2024-01-01T11:00:00.000Z"),
					logsCount: 7,
				},
			]);
			await db.insert(modelHistoryHourly).values({
				modelId: "gpt-4",
				hourTimestamp: new Date("2024-01-01T10:00:00.000Z"),
				logsCount: 3,
			});

			await backfillHourlyHistoryIfNeeded();

			// max() would resume at 12:00 and skip the gap; min() heals it.
			const modelHourly = await db.select().from(modelHistoryHourly);
			const elevenHour = modelHourly.find(
				(r) =>
					r.hourTimestamp.getTime() ===
					new Date("2024-01-01T11:00:00.000Z").getTime(),
			);
			expect(elevenHour?.logsCount).toBe(7);
		});

		it("should ignore the live current-hour row and still backfill older history", async () => {
			// Older minute history that pre-dates the deploy (hour 10:00).
			await db.insert(modelHistory).values({
				modelId: "gpt-4",
				minuteTimestamp: new Date("2024-01-01T10:30:00.000Z"),
				logsCount: 4,
			});
			await db.insert(modelProviderMappingHistory).values({
				modelId: "gpt-4",
				providerId: "openai",
				modelProviderMappingId: "mapping-1",
				minuteTimestamp: new Date("2024-01-01T10:30:00.000Z"),
				logsCount: 4,
			});

			// The minutely loop already wrote the in-progress current hour (12:00)
			// into both tables before this backfill runs.
			await db.insert(modelHistoryHourly).values({
				modelId: "gpt-4",
				hourTimestamp: new Date("2024-01-01T12:00:00.000Z"),
				logsCount: 1,
			});
			await db.insert(modelProviderMappingHistoryHourly).values({
				modelId: "gpt-4",
				providerId: "openai",
				modelProviderMappingId: "mapping-1",
				hourTimestamp: new Date("2024-01-01T12:00:00.000Z"),
				logsCount: 1,
			});

			await backfillHourlyHistoryIfNeeded();

			// The live 12:00 row must NOT be treated as "up to date": the 10:00
			// history has to be rolled up.
			const modelHourly = await db.select().from(modelHistoryHourly);
			const tenHour = modelHourly.find(
				(r) =>
					r.hourTimestamp.getTime() ===
					new Date("2024-01-01T10:00:00.000Z").getTime(),
			);
			expect(tenHour?.logsCount).toBe(4);
		});

		it("should not backfill when hourly history is up to date", async () => {
			// Both tables already hold the current (in-progress) hour 12:00, so the
			// previous complete hour 11:00 is covered and there is nothing to do.
			await db.insert(modelHistoryHourly).values({
				modelId: "gpt-4",
				hourTimestamp: new Date("2024-01-01T12:00:00.000Z"),
				logsCount: 5,
			});
			await db.insert(modelProviderMappingHistoryHourly).values({
				modelId: "gpt-4",
				providerId: "openai",
				modelProviderMappingId: "mapping-1",
				hourTimestamp: new Date("2024-01-01T12:00:00.000Z"),
				logsCount: 5,
			});

			await backfillHourlyHistoryIfNeeded();

			const modelHourly = await db.select().from(modelHistoryHourly);
			expect(modelHourly).toHaveLength(1);
			expect(modelHourly[0]?.logsCount).toBe(5);
		});

		it("should do nothing when no minute history exists", async () => {
			await backfillHourlyHistoryIfNeeded();

			const modelHourly = await db.select().from(modelHistoryHourly);
			const mappingHourly = await db
				.select()
				.from(modelProviderMappingHistoryHourly);
			expect(modelHourly).toHaveLength(0);
			expect(mappingHourly).toHaveLength(0);
		});
	});
});
