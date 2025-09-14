import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
	db,
	provider,
	model,
	modelProviderMapping,
	modelProviderMappingHistory,
	log,
	organization,
	project,
	apiKey,
	eq,
	and,
} from "@llmgateway/db";

import {
	calculateMinutelyHistory,
	calculateAggregatedStatistics,
	calculateUsageStatistics,
} from "./stats-calculator";

// Mock current time for consistent testing
const mockDate = new Date("2024-01-01T12:30:00.000Z");

describe("stats-calculator", () => {
	beforeEach(async () => {
		// Mock Date to have consistent time-based tests
		vi.setSystemTime(mockDate);

		// Clean up test data before each test
		await db.delete(log);
		await db.delete(modelProviderMappingHistory);
		await db.delete(modelProviderMapping);
		await db.delete(model);
		await db.delete(provider);
		await db.delete(apiKey);
		await db.delete(project);
		await db.delete(organization);

		// Set up basic test data - organization, project, api key first
		await db.insert(organization).values([
			{
				id: "org-1",
				name: "Test Organization",
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
				token: "test-key-token",
				description: "Test API Key",
				projectId: "proj-1",
			},
		]);

		await db.insert(provider).values([
			{
				id: "test-provider-1",
				name: "Test Provider 1",
				description: "Test provider 1",
				streaming: true,
				status: "active",
			},
			{
				id: "test-provider-2",
				name: "Test Provider 2",
				description: "Test provider 2",
				streaming: true,
				status: "active",
			},
		]);

		await db.insert(model).values([
			{
				id: "test-model-1",
				name: "Test Model 1",
				family: "test",
				status: "active",
			},
			{
				id: "test-model-2",
				name: "Test Model 2",
				family: "test",
				status: "active",
			},
		]);

		await db.insert(modelProviderMapping).values([
			{
				modelId: "test-model-1",
				providerId: "test-provider-1",
				modelName: "test-model-1",
				streaming: true,
				status: "active",
			},
			{
				modelId: "test-model-2",
				providerId: "test-provider-2",
				modelName: "test-model-2",
				streaming: true,
				status: "active",
			},
		]);
	});

	afterEach(async () => {
		vi.useRealTimers();

		// Clean up test data after each test (in reverse order of dependencies)
		await db.delete(log);
		await db.delete(modelProviderMappingHistory);
		await db.delete(modelProviderMapping);
		await db.delete(model);
		await db.delete(provider);
		await db.delete(apiKey);
		await db.delete(project);
		await db.delete(organization);
	});

	describe("calculateMinutelyHistory", () => {
		it("should calculate and store 1-minute historical data", async () => {
			const previousMinuteStart = new Date("2024-01-01T12:29:00.000Z");

			// Create test logs in the previous minute
			await db.insert(log).values([
				{
					requestId: "req-1",
					organizationId: "org-1",
					projectId: "proj-1",
					apiKeyId: "key-1",
					duration: 1000,
					requestedModel: "test-model-1",
					usedModel: "test-model-1",
					usedProvider: "test-provider-1",
					responseSize: 100,
					hasError: false,
					completionTokens: "50",
					createdAt: new Date("2024-01-01T12:29:30.000Z"),
					mode: "credits",
					usedMode: "credits",
				},
				{
					requestId: "req-2",
					organizationId: "org-1",
					projectId: "proj-1",
					apiKeyId: "key-1",
					duration: 2000,
					requestedModel: "test-model-1",
					usedModel: "test-model-1",
					usedProvider: "test-provider-1",
					responseSize: 200,
					hasError: true,
					completionTokens: "100",
					createdAt: new Date("2024-01-01T12:29:45.000Z"),
					mode: "credits",
					usedMode: "credits",
				},
			]);

			await calculateMinutelyHistory();

			const historyRecords = await db
				.select()
				.from(modelProviderMappingHistory);

			expect(historyRecords).toHaveLength(1);

			const record = historyRecords[0];
			expect(record.modelId).toBe("test-model-1");
			expect(record.providerId).toBe("test-provider-1");
			expect(record.minuteTimestamp).toEqual(previousMinuteStart);
			expect(record.logsCount).toBe(2);
			expect(record.errorsCount).toBe(1);
			expect(record.errorRate).toBe(50); // 1 error out of 2 logs = 50%
			expect(record.totalOutputTokens).toBe(150); // 50 + 100
			expect(record.totalDuration).toBe(3000); // 1000 + 2000
			expect(record.throughput).toBeCloseTo(50); // 150 tokens / 3000ms * 1000 = 50 tokens/sec
		});

		it("should handle multiple model-provider combinations", async () => {
			// Create logs for different model-provider combinations
			await db.insert(log).values([
				{
					requestId: "req-1",
					organizationId: "org-1",
					projectId: "proj-1",
					apiKeyId: "key-1",
					duration: 1000,
					requestedModel: "test-model-1",
					usedModel: "test-model-1",
					usedProvider: "test-provider-1",
					responseSize: 100,
					hasError: false,
					completionTokens: "50",
					createdAt: new Date("2024-01-01T12:29:30.000Z"),
					mode: "credits",
					usedMode: "credits",
				},
				{
					requestId: "req-2",
					organizationId: "org-1",
					projectId: "proj-1",
					apiKeyId: "key-1",
					duration: 2000,
					requestedModel: "test-model-2",
					usedModel: "test-model-2",
					usedProvider: "test-provider-2",
					responseSize: 200,
					hasError: false,
					completionTokens: "100",
					createdAt: new Date("2024-01-01T12:29:45.000Z"),
					mode: "credits",
					usedMode: "credits",
				},
			]);

			await calculateMinutelyHistory();

			const historyRecords = await db
				.select()
				.from(modelProviderMappingHistory)
				.orderBy(modelProviderMappingHistory.modelId);

			expect(historyRecords).toHaveLength(2);
			expect(historyRecords[0].modelId).toBe("test-model-1");
			expect(historyRecords[1].modelId).toBe("test-model-2");
		});

		it("should handle upsert behavior on duplicate minute timestamps", async () => {
			// First calculation with initial data
			await db.insert(log).values([
				{
					requestId: "req-1",
					organizationId: "org-1",
					projectId: "proj-1",
					apiKeyId: "key-1",
					duration: 1000,
					requestedModel: "test-model-1",
					usedModel: "test-model-1",
					usedProvider: "test-provider-1",
					responseSize: 100,
					hasError: false,
					completionTokens: "50",
					createdAt: new Date("2024-01-01T12:29:30.000Z"),
					mode: "credits",
					usedMode: "credits",
				},
			]);

			await calculateMinutelyHistory();

			// Add more logs for the same minute
			await db.insert(log).values([
				{
					requestId: "req-2",
					organizationId: "org-1",
					projectId: "proj-1",
					apiKeyId: "key-1",
					duration: 2000,
					requestedModel: "test-model-1",
					usedModel: "test-model-1",
					usedProvider: "test-provider-1",
					responseSize: 200,
					hasError: true,
					completionTokens: "100",
					createdAt: new Date("2024-01-01T12:29:45.000Z"),
					mode: "credits",
					usedMode: "credits",
				},
			]);

			// Second calculation should update existing record
			await calculateMinutelyHistory();

			const historyRecords = await db
				.select()
				.from(modelProviderMappingHistory);

			expect(historyRecords).toHaveLength(1); // Should still be only one record
			expect(historyRecords[0].logsCount).toBe(2); // Updated count
			expect(historyRecords[0].errorsCount).toBe(1); // Updated error count
		});

		it("should not process logs from current or future minutes", async () => {
			// Create logs in current and future minutes
			await db.insert(log).values([
				{
					requestId: "req-current",
					organizationId: "org-1",
					projectId: "proj-1",
					apiKeyId: "key-1",
					duration: 1000,
					requestedModel: "test-model-1",
					usedModel: "test-model-1",
					usedProvider: "test-provider-1",
					responseSize: 100,
					hasError: false,
					completionTokens: "50",
					createdAt: new Date("2024-01-01T12:30:30.000Z"), // Current minute
					mode: "credits",
					usedMode: "credits",
				},
				{
					requestId: "req-future",
					organizationId: "org-1",
					projectId: "proj-1",
					apiKeyId: "key-1",
					duration: 2000,
					requestedModel: "test-model-1",
					usedModel: "test-model-1",
					usedProvider: "test-provider-1",
					responseSize: 200,
					hasError: false,
					completionTokens: "100",
					createdAt: new Date("2024-01-01T12:31:30.000Z"), // Future minute
					mode: "credits",
					usedMode: "credits",
				},
			]);

			await calculateMinutelyHistory();

			const historyRecords = await db
				.select()
				.from(modelProviderMappingHistory);

			expect(historyRecords).toHaveLength(0); // No records should be created
		});
	});

	describe("calculateAggregatedStatistics", () => {
		beforeEach(async () => {
			// Create history data for testing aggregation
			// Mock time is 12:30:00, so 5-minute window is from 12:25:00 to 12:30:00
			const baseTime = new Date("2024-01-01T12:26:00.000Z"); // Start at 12:26 to get exactly 5 records

			const historyData = [];
			for (let i = 0; i < 5; i++) {
				// Create exactly 5 records for 5-minute window
				const timestamp = new Date(baseTime.getTime() + i * 60000); // Add i minutes
				historyData.push({
					modelId: "test-model-1",
					providerId: "test-provider-1",
					minuteTimestamp: timestamp,
					logsCount: 10,
					errorsCount: 1,
					errorRate: 10,
					throughput: 50,
					totalOutputTokens: 500,
					totalDuration: 10000,
				});
			}

			await db.insert(modelProviderMappingHistory).values(historyData);
		});

		it("should calculate 5-minute aggregated statistics for providers", async () => {
			await calculateAggregatedStatistics();

			const providers = await db
				.select()
				.from(provider)
				.where(eq(provider.id, "test-provider-1"));

			expect(providers).toHaveLength(1);
			const providerStats = providers[0];

			// Should aggregate from the last 5 minutes (5 records)
			expect(providerStats.logsCount).toBe(50); // 10 * 5 records in last 5 minutes
			expect(providerStats.errorsCount).toBe(5); // 1 * 5
			expect(providerStats.errorRate).toBe(10); // Average error rate
			expect(providerStats.throughput).toBe(50); // Average throughput
			expect(providerStats.statsUpdatedAt).toBeDefined();
		});

		it("should calculate 5-minute aggregated statistics for models", async () => {
			await calculateAggregatedStatistics();

			const models = await db
				.select()
				.from(model)
				.where(eq(model.id, "test-model-1"));

			expect(models).toHaveLength(1);
			const modelStats = models[0];

			expect(modelStats.logsCount).toBe(50); // 10 * 5 records in last 5 minutes
			expect(modelStats.errorsCount).toBe(5); // 1 * 5
			expect(modelStats.errorRate).toBe(10);
			expect(modelStats.throughput).toBe(50);
			expect(modelStats.statsUpdatedAt).toBeDefined();
		});

		it("should calculate 5-minute aggregated statistics for model-provider mappings", async () => {
			await calculateAggregatedStatistics();

			const mappings = await db
				.select()
				.from(modelProviderMapping)
				.where(
					and(
						eq(modelProviderMapping.modelId, "test-model-1"),
						eq(modelProviderMapping.providerId, "test-provider-1"),
					),
				);

			expect(mappings).toHaveLength(1);
			const mappingStats = mappings[0];

			expect(mappingStats.logsCount).toBe(50);
			expect(mappingStats.errorsCount).toBe(5);
			expect(mappingStats.errorRate).toBe(10);
			expect(mappingStats.throughput).toBe(50);
			expect(mappingStats.statsUpdatedAt).toBeDefined();
		});

		it("should only include data from the last 5 minutes", async () => {
			// Add some older data (more than 5 minutes old)
			await db.insert(modelProviderMappingHistory).values([
				{
					modelId: "test-model-1",
					providerId: "test-provider-1",
					minuteTimestamp: new Date("2024-01-01T12:20:00.000Z"), // 10 minutes ago
					logsCount: 100,
					errorsCount: 50,
					errorRate: 50,
					throughput: 100,
					totalOutputTokens: 1000,
					totalDuration: 10000,
				},
			]);

			await calculateAggregatedStatistics();

			const providers = await db
				.select()
				.from(provider)
				.where(eq(provider.id, "test-provider-1"));

			const providerStats = providers[0];

			// Should still only aggregate from the last 5 minutes, not including the 10-minute-old data
			expect(providerStats.logsCount).toBe(50); // Not 150 (which would include the old data)
			expect(providerStats.errorsCount).toBe(5); // Not 55
		});

		it("should handle multiple providers and models", async () => {
			// Add history for second model-provider combination
			await db.insert(modelProviderMappingHistory).values([
				{
					modelId: "test-model-2",
					providerId: "test-provider-2",
					minuteTimestamp: new Date("2024-01-01T12:29:00.000Z"),
					logsCount: 20,
					errorsCount: 2,
					errorRate: 10,
					throughput: 60,
					totalOutputTokens: 1000,
					totalDuration: 20000,
				},
			]);

			await calculateAggregatedStatistics();

			// Check both providers got updated
			const allProviders = await db.select().from(provider);
			expect(allProviders.every((p) => p.statsUpdatedAt !== null)).toBe(true);

			// Check both models got updated
			const allModels = await db.select().from(model);
			expect(allModels.every((m) => m.statsUpdatedAt !== null)).toBe(true);
		});
	});

	describe("calculateUsageStatistics (backward compatibility)", () => {
		it("should call calculateAggregatedStatistics", async () => {
			// This test ensures backward compatibility
			await expect(calculateUsageStatistics()).resolves.not.toThrow();
		});
	});

	describe("edge cases", () => {
		it("should handle empty history gracefully", async () => {
			await expect(calculateAggregatedStatistics()).resolves.not.toThrow();

			// Should not update any stats when no history exists
			const providers = await db.select().from(provider);
			expect(providers.every((p) => p.statsUpdatedAt === null)).toBe(true);
		});

		it("should handle zero duration and tokens gracefully", async () => {
			await db.insert(log).values([
				{
					requestId: "req-zero",
					organizationId: "org-1",
					projectId: "proj-1",
					apiKeyId: "key-1",
					duration: 0,
					requestedModel: "test-model-1",
					usedModel: "test-model-1",
					usedProvider: "test-provider-1",
					responseSize: 0,
					hasError: false,
					completionTokens: "0",
					createdAt: new Date("2024-01-01T12:29:30.000Z"),
					mode: "credits",
					usedMode: "credits",
				},
			]);

			await expect(calculateMinutelyHistory()).resolves.not.toThrow();

			const historyRecords = await db
				.select()
				.from(modelProviderMappingHistory);
			expect(historyRecords).toHaveLength(1);
			expect(historyRecords[0].throughput).toBe(0); // Should handle division by zero
		});

		it("should handle missing model or provider references", async () => {
			// Create log with non-existent model/provider
			await db.insert(log).values([
				{
					requestId: "req-missing",
					organizationId: "org-1",
					projectId: "proj-1",
					apiKeyId: "key-1",
					duration: 1000,
					requestedModel: "non-existent-model",
					usedModel: "non-existent-model",
					usedProvider: "non-existent-provider",
					responseSize: 100,
					hasError: false,
					completionTokens: "50",
					createdAt: new Date("2024-01-01T12:29:30.000Z"),
					mode: "credits",
					usedMode: "credits",
				},
			]);

			// Should not crash but also should not create history for non-existent entities
			await expect(calculateMinutelyHistory()).resolves.not.toThrow();

			const historyRecords = await db
				.select()
				.from(modelProviderMappingHistory);
			expect(historyRecords).toHaveLength(0);
		});
	});
});
