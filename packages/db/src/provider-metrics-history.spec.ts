import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { redisClient, waitForSwrMirrorWrites } from "@llmgateway/cache";
import { DEFAULT_ROUTING_HISTORY } from "@llmgateway/shared/routing-config";

import { db } from "./db.js";
import { getProviderMetricsFromHistory } from "./provider-metrics-history.js";
import { metricsKey } from "./provider-metrics.js";
import { modelProviderMappingHistory } from "./schema.js";

let modelId: string | undefined;

afterEach(async () => {
	await waitForSwrMirrorWrites();
	if (modelId) {
		await db
			.delete(modelProviderMappingHistory)
			.where(eq(modelProviderMappingHistory.modelId, modelId));
		modelId = undefined;
	}
});

describe("getProviderMetricsFromHistory", () => {
	it("uses only credit-funded traffic for routing health", async () => {
		const testModelId = `routing-credits-${crypto.randomUUID()}`;
		modelId = testModelId;
		const providerId = "routing-provider";
		const mappingId = "routing-mapping";
		const minuteTimestamp = new Date(Math.floor(Date.now() / 60_000) * 60_000);

		await db.insert(modelProviderMappingHistory).values([
			{
				modelId: testModelId,
				providerId,
				modelProviderMappingId: mappingId,
				usedMode: "credits",
				minuteTimestamp,
				logsCount: 10,
				totalOutputTokens: 100,
				totalDuration: 1_000,
				totalTimeToFirstToken: 1_000,
				timeToFirstTokenCount: 10,
			},
			{
				modelId: testModelId,
				providerId,
				modelProviderMappingId: mappingId,
				usedMode: "api-keys",
				minuteTimestamp,
				logsCount: 90,
				errorsCount: 90,
				upstreamErrorsCount: 90,
				totalOutputTokens: 900,
				totalDuration: 9_000,
				totalTimeToFirstToken: 900_000,
				timeToFirstTokenCount: 90,
			},
		]);

		const metrics = await getProviderMetricsFromHistory(
			[{ modelId: testModelId, providerId }],
			DEFAULT_ROUTING_HISTORY,
		);

		expect(metrics.get(metricsKey(testModelId, providerId))).toEqual({
			modelId: testModelId,
			providerId,
			uptime: 100,
			averageLatency: 100,
			throughput: 100,
			totalRequests: 10,
		});
	});
	it("scores each service tier on its own traffic", async () => {
		const testModelId = `routing-tiers-${crypto.randomUUID()}`;
		modelId = testModelId;
		const providerId = "routing-provider";
		const minuteTimestamp = new Date(Math.floor(Date.now() / 60_000) * 60_000);

		// 10 standard requests succeed; 10 flex requests are all shed upstream.
		await db.insert(modelProviderMappingHistory).values({
			modelId: testModelId,
			providerId,
			modelProviderMappingId: "routing-tiers-mapping",
			usedMode: "credits",
			minuteTimestamp,
			logsCount: 20,
			errorsCount: 10,
			upstreamErrorsCount: 10,
			totalOutputTokens: 300,
			totalDuration: 3_000,
			flexLogsCount: 10,
			flexUpstreamErrorsCount: 10,
			flexTotalOutputTokens: 100,
			flexTotalDuration: 2_000,
		});

		const candidates = [{ modelId: testModelId, providerId }];
		const key = metricsKey(testModelId, providerId);
		const standard = {
			modelId: testModelId,
			providerId,
			uptime: 100,
			throughput: 200,
			totalRequests: 10,
		};

		const [defaultTier, flex, priority] = await Promise.all([
			getProviderMetricsFromHistory(candidates, DEFAULT_ROUTING_HISTORY),
			getProviderMetricsFromHistory(
				candidates,
				DEFAULT_ROUTING_HISTORY,
				"flex",
			),
			getProviderMetricsFromHistory(
				candidates,
				DEFAULT_ROUTING_HISTORY,
				"priority",
			),
		]);

		expect(defaultTier.get(key)).toEqual(standard);
		expect(flex.get(key)).toEqual({
			modelId: testModelId,
			providerId,
			uptime: 0,
			throughput: 50,
			totalRequests: 10,
		});
		// No priority traffic yet, so priority requests use the standard tier.
		expect(priority.get(key)).toEqual(standard);
	});
	it("keeps routing metrics identical when idle buckets are absent", async () => {
		modelId = `sparse-routing-${crypto.randomUUID()}`;
		const candidates = [{ modelId, providerId: "routing-provider" }];
		const minute = Math.floor(Date.now() / 60_000) * 60_000;
		await db.insert(modelProviderMappingHistory).values([
			{
				modelId,
				providerId: "routing-provider",
				modelProviderMappingId: "sparse-routing-mapping",
				usedMode: "credits",
				minuteTimestamp: new Date(minute),
				logsCount: 10,
				totalOutputTokens: 100,
				totalDuration: 1000,
			},
			{
				modelId,
				providerId: "routing-provider",
				modelProviderMappingId: "sparse-routing-mapping",
				usedMode: "credits",
				minuteTimestamp: new Date(minute - 60_000),
			},
		]);
		const dense = await getProviderMetricsFromHistory(
			candidates,
			DEFAULT_ROUTING_HISTORY,
		);
		await waitForSwrMirrorWrites();
		await redisClient.flushdb();
		await db
			.delete(modelProviderMappingHistory)
			.where(
				and(
					eq(modelProviderMappingHistory.modelId, modelId),
					eq(modelProviderMappingHistory.logsCount, 0),
				),
			);
		expect(
			await getProviderMetricsFromHistory(candidates, DEFAULT_ROUTING_HISTORY),
		).toEqual(dense);
	});
});
