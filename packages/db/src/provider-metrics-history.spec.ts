import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { redisClient, waitForSwrMirrorWrites } from "@llmgateway/cache";
import { DEFAULT_ROUTING_HISTORY } from "@llmgateway/shared/routing-config";

import { db } from "./db.js";
import { getProviderMetricsFromHistory } from "./provider-metrics-history.js";
import { metricsKey } from "./provider-metrics.js";
import {
	model,
	provider,
	modelProviderMapping,
	modelProviderMappingHistory,
} from "./schema.js";

let modelId: string | undefined;
let fixtureProviderId: string | undefined;

afterEach(async () => {
	await waitForSwrMirrorWrites();
	if (modelId) {
		await db
			.delete(modelProviderMappingHistory)
			.where(eq(modelProviderMappingHistory.modelId, modelId));
		if (fixtureProviderId) {
			await db
				.delete(modelProviderMapping)
				.where(eq(modelProviderMapping.modelId, modelId));
			await db.delete(model).where(eq(model.id, modelId));
			await db.delete(provider).where(eq(provider.id, fixtureProviderId));
			fixtureProviderId = undefined;
		}
		modelId = undefined;
	}
});

describe("getProviderMetricsFromHistory", () => {
	it("counts regional traffic once in provider totals", async () => {
		modelId = `regional-${crypto.randomUUID()}`;
		fixtureProviderId = `provider-${crypto.randomUUID()}`;
		await db.insert(provider).values({
			id: fixtureProviderId,
			name: "Regional test",
			description: "Regional test",
		});
		await db.insert(model).values({
			id: modelId,
			name: "Regional test",
			description: "Regional test",
			family: "test",
		});
		const [mapping] = await db
			.insert(modelProviderMapping)
			.values({
				id: `${modelId}:region`,
				modelId,
				providerId: fixtureProviderId,
				externalId: modelId,
				region: "region",
			})
			.returning();
		const common = {
			modelId,
			providerId: mapping!.providerId,
			usedMode: "credits" as const,
			minuteTimestamp: new Date(Date.now() - 120_000),
			logsCount: 1,
			totalDuration: 100,
			totalOutputTokens: 10,
			totalTimeToFirstToken: 10,
			timeToFirstTokenCount: 1,
		};
		await db.insert(modelProviderMappingHistory).values([
			{ ...common, modelProviderMappingId: `root-${crypto.randomUUID()}` },
			{ ...common, modelProviderMappingId: mapping!.id },
		]);
		const result = await getProviderMetricsFromHistory(
			[{ modelId, providerId: mapping!.providerId }],
			DEFAULT_ROUTING_HISTORY,
		);
		expect(
			result.get(metricsKey(modelId, mapping!.providerId))?.totalRequests,
		).toBe(1);
	});

	it("keeps fractional weighted samples", async () => {
		modelId = `fractional-${crypto.randomUUID()}`;
		await db.insert(modelProviderMappingHistory).values({
			modelId,
			providerId: "provider",
			modelProviderMappingId: "mapping",
			usedMode: "credits" as const,
			minuteTimestamp: new Date(Date.now() - 120_000),
			logsCount: 1,
			totalDuration: 100,
			totalOutputTokens: 10,
			totalTimeToFirstToken: 10,
			timeToFirstTokenCount: 1,
		});
		const result = await getProviderMetricsFromHistory(
			[{ modelId, providerId: "provider" }],
			{
				...DEFAULT_ROUTING_HISTORY,
				tier1Weight: 0.1,
				tier2Weight: 0.1,
				tier3Weight: 0.1,
			},
		);
		expect(result.get(metricsKey(modelId, "provider"))).toMatchObject({
			totalRequests: 1,
			averageLatency: 10,
			throughput: 100,
			uptime: 100,
		});
	});
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
