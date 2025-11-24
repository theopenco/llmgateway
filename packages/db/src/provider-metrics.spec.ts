import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { db } from "./db.js";
import {
	getProviderMetrics,
	getProviderMetricsForCombinations,
} from "./provider-metrics.js";
import {
	modelProviderMappingHistory,
	provider,
	model,
	modelProviderMapping,
} from "./schema.js";

const mockDate = new Date("2024-01-01T12:30:00.000Z");

describe("provider-metrics", () => {
	beforeEach(async () => {
		vi.setSystemTime(mockDate);

		await db.delete(modelProviderMappingHistory);
		await db.delete(modelProviderMapping);
		await db.delete(model);
		await db.delete(provider);

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

		await db.insert(modelProviderMapping).values([
			{
				id: "mapping-1",
				modelId: "gpt-4",
				providerId: "openai",
				modelName: "gpt-4",
				status: "active",
			},
			{
				id: "mapping-2",
				modelId: "claude-3-5-sonnet",
				providerId: "anthropic",
				modelName: "claude-3-5-sonnet-20241022",
				status: "active",
			},
		]);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	describe("getProviderMetrics", () => {
		it("should return empty map when no history data exists", async () => {
			const metrics = await getProviderMetrics();
			expect(metrics.size).toBe(0);
		});

		it("should calculate uptime and latency correctly for single provider-model", async () => {
			const fourMinutesAgo = new Date("2024-01-01T12:26:00.000Z");

			await db.insert(modelProviderMappingHistory).values({
				modelId: "gpt-4",
				providerId: "openai",
				modelProviderMappingId: "mapping-1",
				minuteTimestamp: fourMinutesAgo,
				logsCount: 100,
				errorsCount: 10,
				upstreamErrorsCount: 10,
				totalDuration: 50000,
				totalTimeToFirstToken: 50000, // 500ms average latency
			});

			const metrics = await getProviderMetrics();

			expect(metrics.size).toBe(1);
			const metric = metrics.get("gpt-4:openai");
			expect(metric).toBeDefined();
			expect(metric?.modelId).toBe("gpt-4");
			expect(metric?.providerId).toBe("openai");
			expect(metric?.totalRequests).toBe(100);
			expect(metric?.uptime).toBe(90);
			expect(metric?.averageLatency).toBe(500);
		});

		it("should aggregate metrics from multiple time periods", async () => {
			const timestamps = [
				new Date("2024-01-01T12:26:00.000Z"),
				new Date("2024-01-01T12:27:00.000Z"),
				new Date("2024-01-01T12:28:00.000Z"),
			];

			await db.insert(modelProviderMappingHistory).values(
				timestamps.map((ts) => ({
					modelId: "gpt-4",
					providerId: "openai",
					modelProviderMappingId: "mapping-1",
					minuteTimestamp: ts,
					logsCount: 50,
					errorsCount: 5,
					upstreamErrorsCount: 5,
					totalDuration: 25000,
					totalTimeToFirstToken: 25000, // 500ms average latency (75000 / 150)
				})),
			);

			const metrics = await getProviderMetrics();

			expect(metrics.size).toBe(1);
			const metric = metrics.get("gpt-4:openai");
			expect(metric?.totalRequests).toBe(150);
			expect(metric?.uptime).toBe(90);
			expect(metric?.averageLatency).toBe(500);
		});

		it("should handle multiple model-provider combinations", async () => {
			const threeMinutesAgo = new Date("2024-01-01T12:27:00.000Z");

			await db.insert(modelProviderMappingHistory).values([
				{
					modelId: "gpt-4",
					providerId: "openai",
					modelProviderMappingId: "mapping-1",
					minuteTimestamp: threeMinutesAgo,
					logsCount: 100,
					errorsCount: 20,
					upstreamErrorsCount: 20,
					totalDuration: 100000,
					totalTimeToFirstToken: 100000, // 1000ms average latency
				},
				{
					modelId: "claude-3-5-sonnet",
					providerId: "anthropic",
					modelProviderMappingId: "mapping-2",
					minuteTimestamp: threeMinutesAgo,
					logsCount: 200,
					errorsCount: 10,
					upstreamErrorsCount: 10,
					totalDuration: 400000,
					totalTimeToFirstToken: 400000, // 2000ms average latency
				},
			]);

			const metrics = await getProviderMetrics();

			expect(metrics.size).toBe(2);

			const gptMetric = metrics.get("gpt-4:openai");
			expect(gptMetric?.uptime).toBe(80);
			expect(gptMetric?.averageLatency).toBe(1000);
			expect(gptMetric?.totalRequests).toBe(100);

			const claudeMetric = metrics.get("claude-3-5-sonnet:anthropic");
			expect(claudeMetric?.uptime).toBe(95);
			expect(claudeMetric?.averageLatency).toBe(2000);
			expect(claudeMetric?.totalRequests).toBe(200);
		});

		it("should only include data from the last N minutes", async () => {
			const twoMinutesAgo = new Date("2024-01-01T12:28:00.000Z");
			const tenMinutesAgo = new Date("2024-01-01T12:20:00.000Z");

			await db.insert(modelProviderMappingHistory).values([
				{
					modelId: "gpt-4",
					providerId: "openai",
					modelProviderMappingId: "mapping-1",
					minuteTimestamp: twoMinutesAgo,
					logsCount: 100,
					errorsCount: 10,
					upstreamErrorsCount: 10,
					totalDuration: 50000,
				},
				{
					modelId: "gpt-4",
					providerId: "openai",
					modelProviderMappingId: "mapping-1",
					minuteTimestamp: tenMinutesAgo,
					logsCount: 1000,
					errorsCount: 100,
					upstreamErrorsCount: 100,
					totalDuration: 500000,
				},
			]);

			const metrics = await getProviderMetrics(5);

			expect(metrics.size).toBe(1);
			const metric = metrics.get("gpt-4:openai");
			expect(metric?.totalRequests).toBe(100);
		});

		it("should handle custom time windows", async () => {
			const timestamps = [
				new Date("2024-01-01T12:25:00.000Z"),
				new Date("2024-01-01T12:20:00.000Z"),
			];

			await db.insert(modelProviderMappingHistory).values(
				timestamps.map((ts) => ({
					modelId: "gpt-4",
					providerId: "openai",
					modelProviderMappingId: "mapping-1",
					minuteTimestamp: ts,
					logsCount: 50,
					errorsCount: 5,
					upstreamErrorsCount: 5,
					totalDuration: 25000,
				})),
			);

			const metricsDefault = await getProviderMetrics(5);
			expect(metricsDefault.get("gpt-4:openai")?.totalRequests).toBe(50);

			const metricsLargeWindow = await getProviderMetrics(15);
			expect(metricsLargeWindow.get("gpt-4:openai")?.totalRequests).toBe(100);
		});

		it("should skip entries with zero logs", async () => {
			const fourMinutesAgo = new Date("2024-01-01T12:26:00.000Z");

			await db.insert(modelProviderMappingHistory).values({
				modelId: "gpt-4",
				providerId: "openai",
				modelProviderMappingId: "mapping-1",
				minuteTimestamp: fourMinutesAgo,
				logsCount: 0,
				errorsCount: 0,
				upstreamErrorsCount: 0,
				totalDuration: 0,
			});

			const metrics = await getProviderMetrics();
			expect(metrics.size).toBe(0);
		});

		it("should calculate 100% uptime when no errors", async () => {
			const fourMinutesAgo = new Date("2024-01-01T12:26:00.000Z");

			await db.insert(modelProviderMappingHistory).values({
				modelId: "gpt-4",
				providerId: "openai",
				modelProviderMappingId: "mapping-1",
				minuteTimestamp: fourMinutesAgo,
				logsCount: 100,
				errorsCount: 0,
				upstreamErrorsCount: 0,
				totalDuration: 50000,
			});

			const metrics = await getProviderMetrics();
			const metric = metrics.get("gpt-4:openai");
			expect(metric?.uptime).toBe(100);
		});

		it("should calculate 0% uptime when all requests fail", async () => {
			const fourMinutesAgo = new Date("2024-01-01T12:26:00.000Z");

			await db.insert(modelProviderMappingHistory).values({
				modelId: "gpt-4",
				providerId: "openai",
				modelProviderMappingId: "mapping-1",
				minuteTimestamp: fourMinutesAgo,
				logsCount: 100,
				errorsCount: 100,
				upstreamErrorsCount: 100,
				totalDuration: 50000,
			});

			const metrics = await getProviderMetrics();
			const metric = metrics.get("gpt-4:openai");
			expect(metric?.uptime).toBe(0);
		});

		it("should handle null or zero totalDuration gracefully", async () => {
			const fourMinutesAgo = new Date("2024-01-01T12:26:00.000Z");

			await db.insert(modelProviderMappingHistory).values({
				modelId: "gpt-4",
				providerId: "openai",
				modelProviderMappingId: "mapping-1",
				minuteTimestamp: fourMinutesAgo,
				logsCount: 100,
				errorsCount: 10,
				upstreamErrorsCount: 10,
				totalDuration: 0,
			});

			const metrics = await getProviderMetrics();
			const metric = metrics.get("gpt-4:openai");
			expect(metric?.averageLatency).toBe(0);
		});
	});

	describe("getProviderMetricsForCombinations", () => {
		it("should return empty map when no combinations provided", async () => {
			const metrics = await getProviderMetricsForCombinations([]);
			expect(metrics.size).toBe(0);
		});

		it("should return metrics for specific combinations only", async () => {
			const fourMinutesAgo = new Date("2024-01-01T12:26:00.000Z");

			await db.insert(modelProviderMappingHistory).values([
				{
					modelId: "gpt-4",
					providerId: "openai",
					modelProviderMappingId: "mapping-1",
					minuteTimestamp: fourMinutesAgo,
					logsCount: 100,
					errorsCount: 10,
					upstreamErrorsCount: 10,
					totalDuration: 50000,
				},
				{
					modelId: "claude-3-5-sonnet",
					providerId: "anthropic",
					modelProviderMappingId: "mapping-2",
					minuteTimestamp: fourMinutesAgo,
					logsCount: 200,
					errorsCount: 20,
					upstreamErrorsCount: 20,
					totalDuration: 100000,
				},
			]);

			const metrics = await getProviderMetricsForCombinations([
				{ modelId: "gpt-4", providerId: "openai" },
			]);

			expect(metrics.size).toBe(1);
			expect(metrics.has("gpt-4:openai")).toBe(true);
			expect(metrics.has("claude-3-5-sonnet:anthropic")).toBe(false);
		});

		it("should return metrics for multiple combinations", async () => {
			const fourMinutesAgo = new Date("2024-01-01T12:26:00.000Z");

			await db.insert(modelProviderMappingHistory).values([
				{
					modelId: "gpt-4",
					providerId: "openai",
					modelProviderMappingId: "mapping-1",
					minuteTimestamp: fourMinutesAgo,
					logsCount: 100,
					errorsCount: 10,
					upstreamErrorsCount: 10,
					totalDuration: 50000,
				},
				{
					modelId: "claude-3-5-sonnet",
					providerId: "anthropic",
					modelProviderMappingId: "mapping-2",
					minuteTimestamp: fourMinutesAgo,
					logsCount: 200,
					errorsCount: 20,
					upstreamErrorsCount: 20,
					totalDuration: 100000,
				},
			]);

			const metrics = await getProviderMetricsForCombinations([
				{ modelId: "gpt-4", providerId: "openai" },
				{ modelId: "claude-3-5-sonnet", providerId: "anthropic" },
			]);

			expect(metrics.size).toBe(2);
			expect(metrics.get("gpt-4:openai")?.totalRequests).toBe(100);
			expect(metrics.get("claude-3-5-sonnet:anthropic")?.totalRequests).toBe(
				200,
			);
		});

		it("should aggregate metrics from multiple time periods for combinations", async () => {
			const timestamps = [
				new Date("2024-01-01T12:26:00.000Z"),
				new Date("2024-01-01T12:27:00.000Z"),
				new Date("2024-01-01T12:28:00.000Z"),
			];

			await db.insert(modelProviderMappingHistory).values(
				timestamps.map((ts) => ({
					modelId: "gpt-4",
					providerId: "openai",
					modelProviderMappingId: "mapping-1",
					minuteTimestamp: ts,
					logsCount: 50,
					errorsCount: 5,
					upstreamErrorsCount: 5,
					totalDuration: 25000,
					totalTimeToFirstToken: 25000, // 500ms average latency
				})),
			);

			const metrics = await getProviderMetricsForCombinations([
				{ modelId: "gpt-4", providerId: "openai" },
			]);

			expect(metrics.size).toBe(1);
			const metric = metrics.get("gpt-4:openai");
			expect(metric?.totalRequests).toBe(150);
			expect(metric?.uptime).toBe(90);
			expect(metric?.averageLatency).toBe(500);
		});

		it("should respect custom time windows", async () => {
			const timestamps = [
				new Date("2024-01-01T12:25:00.000Z"),
				new Date("2024-01-01T12:20:00.000Z"),
			];

			await db.insert(modelProviderMappingHistory).values(
				timestamps.map((ts) => ({
					modelId: "gpt-4",
					providerId: "openai",
					modelProviderMappingId: "mapping-1",
					minuteTimestamp: ts,
					logsCount: 50,
					errorsCount: 5,
					upstreamErrorsCount: 5,
					totalDuration: 25000,
				})),
			);

			const metricsDefault = await getProviderMetricsForCombinations(
				[{ modelId: "gpt-4", providerId: "openai" }],
				5,
			);
			expect(metricsDefault.get("gpt-4:openai")?.totalRequests).toBe(50);

			const metricsLargeWindow = await getProviderMetricsForCombinations(
				[{ modelId: "gpt-4", providerId: "openai" }],
				15,
			);
			expect(metricsLargeWindow.get("gpt-4:openai")?.totalRequests).toBe(100);
		});

		it("should only return combinations that have data", async () => {
			const fourMinutesAgo = new Date("2024-01-01T12:26:00.000Z");

			await db.insert(modelProviderMappingHistory).values({
				modelId: "gpt-4",
				providerId: "openai",
				modelProviderMappingId: "mapping-1",
				minuteTimestamp: fourMinutesAgo,
				logsCount: 100,
				errorsCount: 10,
				upstreamErrorsCount: 10,
				totalDuration: 50000,
			});

			const metrics = await getProviderMetricsForCombinations([
				{ modelId: "gpt-4", providerId: "openai" },
				{ modelId: "claude-3-5-sonnet", providerId: "anthropic" },
			]);

			expect(metrics.size).toBe(1);
			expect(metrics.has("gpt-4:openai")).toBe(true);
			expect(metrics.has("claude-3-5-sonnet:anthropic")).toBe(false);
		});

		it("should skip combinations with zero logs", async () => {
			const fourMinutesAgo = new Date("2024-01-01T12:26:00.000Z");

			await db.insert(modelProviderMappingHistory).values({
				modelId: "gpt-4",
				providerId: "openai",
				modelProviderMappingId: "mapping-1",
				minuteTimestamp: fourMinutesAgo,
				logsCount: 0,
				errorsCount: 0,
				upstreamErrorsCount: 0,
				totalDuration: 0,
			});

			const metrics = await getProviderMetricsForCombinations([
				{ modelId: "gpt-4", providerId: "openai" },
			]);

			expect(metrics.size).toBe(0);
		});

		it("should calculate correct metrics for partial failures", async () => {
			const fourMinutesAgo = new Date("2024-01-01T12:26:00.000Z");

			await db.insert(modelProviderMappingHistory).values({
				modelId: "gpt-4",
				providerId: "openai",
				modelProviderMappingId: "mapping-1",
				minuteTimestamp: fourMinutesAgo,
				logsCount: 100,
				errorsCount: 25,
				upstreamErrorsCount: 25,
				totalDuration: 150000,
				totalTimeToFirstToken: 150000, // 1500ms average latency
			});

			const metrics = await getProviderMetricsForCombinations([
				{ modelId: "gpt-4", providerId: "openai" },
			]);

			const metric = metrics.get("gpt-4:openai");
			expect(metric?.uptime).toBe(75);
			expect(metric?.averageLatency).toBe(1500);
			expect(metric?.totalRequests).toBe(100);
		});

		it("should handle single combination efficiently", async () => {
			const fourMinutesAgo = new Date("2024-01-01T12:26:00.000Z");

			await db.insert(modelProviderMappingHistory).values({
				modelId: "gpt-4",
				providerId: "openai",
				modelProviderMappingId: "mapping-1",
				minuteTimestamp: fourMinutesAgo,
				logsCount: 100,
				errorsCount: 10,
				upstreamErrorsCount: 10,
				totalDuration: 50000,
			});

			const metrics = await getProviderMetricsForCombinations([
				{ modelId: "gpt-4", providerId: "openai" },
			]);

			expect(metrics.size).toBe(1);
			const metric = metrics.get("gpt-4:openai");
			expect(metric?.modelId).toBe("gpt-4");
			expect(metric?.providerId).toBe("openai");
			expect(metric?.uptime).toBe(90);
		});
	});
});
