import { eq } from "drizzle-orm";
import { describe, it, expect, beforeEach } from "vitest";

import { redisClient } from "@llmgateway/cache";

import { db } from "./db.js";
import {
	getProviderMetrics,
	getProviderMetricsForCombinations,
	metricsKey,
} from "./provider-metrics.js";
import { provider, model, modelProviderMapping } from "./schema.js";

describe("provider-metrics", () => {
	beforeEach(async () => {
		await redisClient.flushdb();
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

	describe("getProviderMetrics", () => {
		it("should return empty map when no routing metrics are set", async () => {
			const metrics = await getProviderMetrics();
			expect(metrics.size).toBe(0);
		});

		it("should return pre-computed routing metrics for a single provider-model", async () => {
			await db
				.update(modelProviderMapping)
				.set({
					routingUptime: 90,
					routingLatency: 500,
					routingThroughput: 50,
					routingTotalRequests: 100,
				})
				.where(eq(modelProviderMapping.id, "mapping-1"));

			const metrics = await getProviderMetrics();

			expect(metrics.size).toBe(1);
			const metric = metrics.get(
				metricsKey("gpt-4", "openai", undefined, "gpt-4"),
			);
			expect(metric).toBeDefined();
			expect(metric?.modelId).toBe("gpt-4");
			expect(metric?.providerId).toBe("openai");
			expect(metric?.uptime).toBe(90);
			expect(metric?.averageLatency).toBe(500);
			expect(metric?.throughput).toBe(50);
			expect(metric?.totalRequests).toBe(100);
		});

		it("should handle multiple model-provider combinations", async () => {
			await db
				.update(modelProviderMapping)
				.set({
					routingUptime: 80,
					routingLatency: 1000,
					routingThroughput: 30,
					routingTotalRequests: 100,
				})
				.where(eq(modelProviderMapping.id, "mapping-1"));

			await db
				.update(modelProviderMapping)
				.set({
					routingUptime: 95,
					routingLatency: 2000,
					routingThroughput: 60,
					routingTotalRequests: 200,
				})
				.where(eq(modelProviderMapping.id, "mapping-2"));

			const metrics = await getProviderMetrics();

			expect(metrics.size).toBe(2);

			const gptMetric = metrics.get(
				metricsKey("gpt-4", "openai", undefined, "gpt-4"),
			);
			expect(gptMetric?.uptime).toBe(80);
			expect(gptMetric?.averageLatency).toBe(1000);
			expect(gptMetric?.totalRequests).toBe(100);

			const claudeMetric = metrics.get(
				metricsKey(
					"claude-3-5-sonnet",
					"anthropic",
					undefined,
					"claude-3-5-sonnet-20241022",
				),
			);
			expect(claudeMetric?.uptime).toBe(95);
			expect(claudeMetric?.averageLatency).toBe(2000);
			expect(claudeMetric?.totalRequests).toBe(200);
		});

		it("should skip mappings with null routing metrics", async () => {
			// mapping-1 has no routing metrics set (null)
			// mapping-2 has routing metrics
			await db
				.update(modelProviderMapping)
				.set({
					routingUptime: 99,
					routingLatency: 300,
					routingThroughput: 80,
					routingTotalRequests: 500,
				})
				.where(eq(modelProviderMapping.id, "mapping-2"));

			const metrics = await getProviderMetrics();
			expect(metrics.size).toBe(1);
			expect(
				metrics.has(
					metricsKey(
						"claude-3-5-sonnet",
						"anthropic",
						undefined,
						"claude-3-5-sonnet-20241022",
					),
				),
			).toBe(true);
			expect(
				metrics.has(metricsKey("gpt-4", "openai", undefined, "gpt-4")),
			).toBe(false);
		});

		it("should skip mappings with zero total requests", async () => {
			await db
				.update(modelProviderMapping)
				.set({
					routingUptime: 100,
					routingLatency: 0,
					routingThroughput: 0,
					routingTotalRequests: 0,
				})
				.where(eq(modelProviderMapping.id, "mapping-1"));

			const metrics = await getProviderMetrics();
			expect(metrics.size).toBe(0);
		});

		it("should return 100% uptime when set", async () => {
			await db
				.update(modelProviderMapping)
				.set({
					routingUptime: 100,
					routingLatency: 200,
					routingThroughput: 40,
					routingTotalRequests: 50,
				})
				.where(eq(modelProviderMapping.id, "mapping-1"));

			const metrics = await getProviderMetrics();
			const metric = metrics.get(
				metricsKey("gpt-4", "openai", undefined, "gpt-4"),
			);
			expect(metric?.uptime).toBe(100);
		});

		it("should return 0% uptime when set", async () => {
			await db
				.update(modelProviderMapping)
				.set({
					routingUptime: 0,
					routingLatency: 0,
					routingThroughput: 0,
					routingTotalRequests: 100,
				})
				.where(eq(modelProviderMapping.id, "mapping-1"));

			const metrics = await getProviderMetrics();
			const metric = metrics.get(
				metricsKey("gpt-4", "openai", undefined, "gpt-4"),
			);
			expect(metric?.uptime).toBe(0);
		});

		it("should return undefined for null latency and throughput", async () => {
			await db
				.update(modelProviderMapping)
				.set({
					routingUptime: 95,
					routingLatency: null,
					routingThroughput: null,
					routingTotalRequests: 100,
				})
				.where(eq(modelProviderMapping.id, "mapping-1"));

			const metrics = await getProviderMetrics();
			const metric = metrics.get(
				metricsKey("gpt-4", "openai", undefined, "gpt-4"),
			);
			expect(metric).toBeDefined();
			expect(metric?.uptime).toBe(95);
			expect(metric?.averageLatency).toBeUndefined();
			expect(metric?.throughput).toBeUndefined();
			expect(metric?.totalRequests).toBe(100);
		});

		it("should return undefined for null uptime", async () => {
			await db
				.update(modelProviderMapping)
				.set({
					routingUptime: null,
					routingLatency: 500,
					routingThroughput: 50,
					routingTotalRequests: 100,
				})
				.where(eq(modelProviderMapping.id, "mapping-1"));

			const metrics = await getProviderMetrics();
			const metric = metrics.get(
				metricsKey("gpt-4", "openai", undefined, "gpt-4"),
			);
			expect(metric).toBeDefined();
			expect(metric?.uptime).toBeUndefined();
			expect(metric?.averageLatency).toBe(500);
			expect(metric?.throughput).toBe(50);
			expect(metric?.totalRequests).toBe(100);
		});
	});

	describe("getProviderMetricsForCombinations", () => {
		it("should return empty map when no combinations provided", async () => {
			const metrics = await getProviderMetricsForCombinations([]);
			expect(metrics.size).toBe(0);
		});

		it("should return metrics for specific combinations only", async () => {
			await db
				.update(modelProviderMapping)
				.set({
					routingUptime: 90,
					routingLatency: 500,
					routingThroughput: 50,
					routingTotalRequests: 100,
				})
				.where(eq(modelProviderMapping.id, "mapping-1"));

			await db
				.update(modelProviderMapping)
				.set({
					routingUptime: 95,
					routingLatency: 800,
					routingThroughput: 60,
					routingTotalRequests: 200,
				})
				.where(eq(modelProviderMapping.id, "mapping-2"));

			const metrics = await getProviderMetricsForCombinations([
				{ modelId: "gpt-4", providerId: "openai", modelName: "gpt-4" },
			]);

			expect(metrics.size).toBe(1);
			expect(
				metrics.has(metricsKey("gpt-4", "openai", undefined, "gpt-4")),
			).toBe(true);
			expect(
				metrics.has(
					metricsKey(
						"claude-3-5-sonnet",
						"anthropic",
						undefined,
						"claude-3-5-sonnet-20241022",
					),
				),
			).toBe(false);
		});

		it("should return metrics for multiple combinations", async () => {
			await db
				.update(modelProviderMapping)
				.set({
					routingUptime: 90,
					routingLatency: 500,
					routingThroughput: 50,
					routingTotalRequests: 100,
				})
				.where(eq(modelProviderMapping.id, "mapping-1"));

			await db
				.update(modelProviderMapping)
				.set({
					routingUptime: 95,
					routingLatency: 800,
					routingThroughput: 60,
					routingTotalRequests: 200,
				})
				.where(eq(modelProviderMapping.id, "mapping-2"));

			const metrics = await getProviderMetricsForCombinations([
				{ modelId: "gpt-4", providerId: "openai", modelName: "gpt-4" },
				{
					modelId: "claude-3-5-sonnet",
					providerId: "anthropic",
					modelName: "claude-3-5-sonnet-20241022",
				},
			]);

			expect(metrics.size).toBe(2);
			expect(
				metrics.get(metricsKey("gpt-4", "openai", undefined, "gpt-4"))
					?.totalRequests,
			).toBe(100);
			expect(
				metrics.get(
					metricsKey(
						"claude-3-5-sonnet",
						"anthropic",
						undefined,
						"claude-3-5-sonnet-20241022",
					),
				)?.totalRequests,
			).toBe(200);
		});

		it("should only return combinations that have routing data", async () => {
			// Only set routing metrics on mapping-1
			await db
				.update(modelProviderMapping)
				.set({
					routingUptime: 90,
					routingLatency: 500,
					routingThroughput: 50,
					routingTotalRequests: 100,
				})
				.where(eq(modelProviderMapping.id, "mapping-1"));

			const metrics = await getProviderMetricsForCombinations([
				{ modelId: "gpt-4", providerId: "openai", modelName: "gpt-4" },
				{
					modelId: "claude-3-5-sonnet",
					providerId: "anthropic",
					modelName: "claude-3-5-sonnet-20241022",
				},
			]);

			expect(metrics.size).toBe(1);
			expect(
				metrics.has(metricsKey("gpt-4", "openai", undefined, "gpt-4")),
			).toBe(true);
			expect(
				metrics.has(
					metricsKey(
						"claude-3-5-sonnet",
						"anthropic",
						undefined,
						"claude-3-5-sonnet-20241022",
					),
				),
			).toBe(false);
		});

		it("should skip combinations with zero total requests", async () => {
			await db
				.update(modelProviderMapping)
				.set({
					routingUptime: 100,
					routingLatency: 0,
					routingThroughput: 0,
					routingTotalRequests: 0,
				})
				.where(eq(modelProviderMapping.id, "mapping-1"));

			const metrics = await getProviderMetricsForCombinations([
				{ modelId: "gpt-4", providerId: "openai", modelName: "gpt-4" },
			]);

			expect(metrics.size).toBe(0);
		});

		it("should return correct metrics for single combination", async () => {
			await db
				.update(modelProviderMapping)
				.set({
					routingUptime: 75,
					routingLatency: 1500,
					routingThroughput: 25,
					routingTotalRequests: 100,
				})
				.where(eq(modelProviderMapping.id, "mapping-1"));

			const metrics = await getProviderMetricsForCombinations([
				{ modelId: "gpt-4", providerId: "openai", modelName: "gpt-4" },
			]);

			expect(metrics.size).toBe(1);
			const metric = metrics.get(
				metricsKey("gpt-4", "openai", undefined, "gpt-4"),
			);
			expect(metric?.modelId).toBe("gpt-4");
			expect(metric?.providerId).toBe("openai");
			expect(metric?.uptime).toBe(75);
			expect(metric?.averageLatency).toBe(1500);
			expect(metric?.throughput).toBe(25);
			expect(metric?.totalRequests).toBe(100);
		});

		it("disambiguates virtual model variants that share modelId/providerId/region", async () => {
			await db.insert(model).values({
				id: "virtual-grok",
				name: "Virtual Grok",
				family: "grok",
				status: "active",
			});

			await db.insert(modelProviderMapping).values([
				{
					id: "virtual-grok-non-reasoning",
					modelId: "virtual-grok",
					providerId: "openai",
					modelName: "virtual-grok-non-reasoning",
					status: "active",
					routingUptime: 99,
					routingLatency: 100,
					routingThroughput: 200,
					routingTotalRequests: 100,
				},
				{
					id: "virtual-grok-reasoning",
					modelId: "virtual-grok",
					providerId: "openai",
					modelName: "virtual-grok-reasoning",
					status: "active",
					routingUptime: 50,
					routingLatency: 1000,
					routingThroughput: 10,
					routingTotalRequests: 100,
				},
			]);

			const metrics = await getProviderMetricsForCombinations([
				{
					modelId: "virtual-grok",
					providerId: "openai",
					modelName: "virtual-grok-non-reasoning",
				},
				{
					modelId: "virtual-grok",
					providerId: "openai",
					modelName: "virtual-grok-reasoning",
				},
			]);

			const nonReasoning = metrics.get(
				metricsKey(
					"virtual-grok",
					"openai",
					undefined,
					"virtual-grok-non-reasoning",
				),
			);
			const reasoning = metrics.get(
				metricsKey(
					"virtual-grok",
					"openai",
					undefined,
					"virtual-grok-reasoning",
				),
			);

			expect(nonReasoning?.uptime).toBe(99);
			expect(nonReasoning?.averageLatency).toBe(100);
			expect(reasoning?.uptime).toBe(50);
			expect(reasoning?.averageLatency).toBe(1000);
		});
	});
});
